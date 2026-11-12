import { api, type IdentityCandidate } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import type { BoardItem } from "@/lib/board-items"
import { applyIdentities, candidatesForLink, identityConflict } from "@/lib/identity-flow"
import { pickIdentityCandidate } from "@/lib/identity-pick"
import {
  adoptsIdentityWithoutConfirm,
  requestDefaultsOf,
  type BoardRequestDefaults
} from "@/lib/task-form"

/*
 * 流水线 A 启动前把页面身份自动落实：取数与写回走 identity-flow，采用判定走 identity-pick。
 * 人写下的 Target 优先；否则先走机械候选，只有「自动」层级才让模型补语义名。
 * 后端 blocked 时停回调用方。B/AB 继续走原有身份流程。
 */

export type PreparedPipelineItem = BoardItem & { ui: string }
export type PreparedPipelineIdentity = {
  link: string
  projectRoot: string
  pageName: string
  item: IdentityCandidate
}

export type PreparedPipelineItems =
  | {
      ok: true
      items: PreparedPipelineItem[]
      defaults: BoardRequestDefaults
      identities: PreparedPipelineIdentity[]
    }
  | { ok: false; reason: string }

const PIPELINE_A_REQUEST_DEFAULTS = requestDefaultsOf({
  ui: "",
  autoMerge: true,
  overwrite: true,
  stopAfter: ""
})

async function prepareOne(
  item: BoardItem,
  projectRoot: string,
  automation: string
): Promise<{ item: PreparedPipelineItem; identity: PreparedPipelineIdentity } | string> {
  try {
    const named = await api.designPageName(item.link)
    const base = { link: item.link, projectRoot, pageName: named.pageName, ui: "" }
    let got = await candidatesForLink({ ...base, useAi: false, autoAdopt: true })
    const explicitTarget = item.target.trim()
    if (explicitTarget) {
      const conflict = identityConflict({ target: explicitTarget, candidates: got.items })
      if (conflict) {
        return "这个链接在登记表里是 " + conflict.target +
          (conflict.ui ? "（区域 " + conflict.ui + "）" : "") +
          "，你写的 Target 是 " + explicitTarget +
          "。请改成链接指向的那一页，或确认链接是否贴错了。"
      }
      let candidate = got.items.find((entry) => entry.target === explicitTarget) || null
      if (!candidate) {
        const prefix = await api.identityPrefix(explicitTarget)
        if (!prefix.previewUi) {
          return "看板行里的 Target「" + explicitTarget + "」推不出区域前缀：请写成「区域 + 语义名」后重试。"
        }
        candidate = {
          target: explicitTarget,
          ui: prefix.previewUi,
          semanticName: explicitTarget.slice(prefix.previewUi.length),
          basis: "看板行手写的 Target",
          needsSemanticName: false
        }
      }
      return {
        item: { ...item, target: candidate.target, ui: candidate.ui },
        identity: { link: item.link, projectRoot, pageName: named.pageName, item: candidate }
      }
    }

    let decision = pickIdentityCandidate(got.items, got.blocked, { autoOnly: true })
    const allowAi = adoptsIdentityWithoutConfirm(automation)
    if (!decision.pick && !got.blocked && allowAi) {
      got = await candidatesForLink({ ...base, useAi: true, autoAdopt: true })
      decision = pickIdentityCandidate(got.items, got.blocked, { autoOnly: true })
    }
    if (!decision.pick) {
      return !got.blocked && !allowAi
        ? decision.reason + " 当前自动化层级不会把模型候选直接写回；切到「自动」后重试。"
        : decision.reason
    }
    return {
      item: { ...item, target: decision.pick.target, ui: decision.pick.ui },
      identity: { link: item.link, projectRoot, pageName: named.pageName, item: decision.pick }
    }
  } catch (error) {
    return describeFailure(error)
  }
}

/** 逐项只读准备；身份写回在任务创建事务内由 commitPipelineAIdentities 一次完成。 */
export async function preparePipelineAItems(
  items: BoardItem[],
  projectRoot: string,
  options: { automation: string }
): Promise<PreparedPipelineItems> {
  const prepared: PreparedPipelineItem[] = []
  const identities: PreparedPipelineIdentity[] = []
  for (const item of items) {
    const result = await prepareOne(item, projectRoot, options.automation)
    if (typeof result === "string") return { ok: false, reason: result }
    prepared.push(result.item)
    identities.push(result.identity)
  }
  return {
    ok: true,
    items: prepared,
    defaults: PIPELINE_A_REQUEST_DEFAULTS,
    identities
  }
}

/** 任务已经创建、页面 PNG 已经暂存后写回身份；登记表同样整批成功或整批不写。 */
export async function commitPipelineAIdentities(identities: PreparedPipelineIdentity[]): Promise<void> {
  await applyIdentities(identities)
}
