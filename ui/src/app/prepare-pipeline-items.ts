import { api, type BoardAddBody, type IdentityCandidate } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import type { BoardItem } from "@/lib/board-items"
import { applyIdentity, candidatesForLink } from "@/lib/identity-flow"
import { pickIdentityCandidate } from "@/lib/identity-pick"

/*
 * 流水线 A 启动前把页面身份自动落实：取数与写回走 identity-flow，采用判定走 identity-pick。
 * 先走机械候选，必要时让模型补语义名；后端 blocked 时停回调用方。B/AB 继续走原有身份流程。
 */

export type PreparedPipelineItem = BoardItem & { ui: string }
export type PipelineARequestDefaults = Pick<BoardAddBody, "ui" | "autoMerge" | "overwrite" | "stopAfter">
export type RequestDefaultsInput = {
  ui: string
  autoMerge: boolean
  overwrite: boolean
  stopAfter: string
}
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
      defaults: PipelineARequestDefaults
      identities: PreparedPipelineIdentity[]
    }
  | { ok: false; reason: string }

export function requestDefaultsOf(input: RequestDefaultsInput): PipelineARequestDefaults {
  return {
    ui: input.ui.trim(),
    autoMerge: input.autoMerge,
    overwrite: input.overwrite,
    stopAfter: input.stopAfter.trim()
  }
}

const PIPELINE_A_REQUEST_DEFAULTS = requestDefaultsOf({
  ui: "",
  autoMerge: true,
  overwrite: true,
  stopAfter: ""
})

async function prepareOne(
  item: BoardItem,
  projectRoot: string,
  useAi: boolean
): Promise<{ item: PreparedPipelineItem; identity: PreparedPipelineIdentity } | string> {
  try {
    const named = await api.designPageName(item.link)
    const base = { link: item.link, projectRoot, pageName: named.pageName, ui: "" }
    let got = await candidatesForLink({ ...base, useAi: false, autoAdopt: true })
    let decision = pickIdentityCandidate(got.items, got.blocked, { autoOnly: true })
    if (!decision.pick && !got.blocked && useAi) {
      got = await candidatesForLink({ ...base, useAi: true, autoAdopt: true })
      decision = pickIdentityCandidate(got.items, got.blocked, { autoOnly: true })
    }
    if (!decision.pick) return decision.reason
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
  options: { useAi: boolean }
): Promise<PreparedPipelineItems> {
  const prepared: PreparedPipelineItem[] = []
  const identities: PreparedPipelineIdentity[] = []
  for (const item of items) {
    const result = await prepareOne(item, projectRoot, options.useAi)
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

/** 任务已经创建、页面 PNG 已经暂存后写回身份；任一条失败由创建编排整批撤销任务。 */
export async function commitPipelineAIdentities(identities: PreparedPipelineIdentity[]): Promise<void> {
  for (const identity of identities) {
    await applyIdentity({
      link: identity.link,
      projectRoot: identity.projectRoot,
      pageName: identity.pageName,
      item: identity.item
    })
  }
}
