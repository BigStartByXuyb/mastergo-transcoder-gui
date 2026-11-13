import type { IdentityCandidate } from "@/lib/api"
import type { BoardItem } from "@/lib/board-items"
import { prepareLinkIdentity } from "@/lib/identity-flow"
import {
  adoptsIdentityWithoutConfirm,
  requestDefaultsOf,
  type BoardRequestDefaults
} from "@/lib/task-form"

/*
 * 流水线 A 启动前把页面身份自动落实：逐链接准备走 identity-flow 的共同编排。
 * 人写下的 Target 优先；否则只采用能直接写回的候选，只有「自动」层级才允许模型补语义名。
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

/** 逐项只读准备；身份写回在任务创建事务内由 applyIdentities 一次完成。 */
export async function preparePipelineAItems(
  items: BoardItem[],
  projectRoot: string,
  options: { automation: string }
): Promise<PreparedPipelineItems> {
  const prepared: PreparedPipelineItem[] = []
  const identities: PreparedPipelineIdentity[] = []
  const allowAi = adoptsIdentityWithoutConfirm(options.automation)
  for (const item of items) {
    const result = await prepareLinkIdentity({
      link: item.link,
      projectRoot: projectRoot,
      target: item.target,
      ui: "",
      useAi: false,
      autoAdopt: true,
      autoOnly: true,
      aiFallback: allowAi
    })
    if (result.kind === "rejected") return { ok: false, reason: result.reason }
    if (result.kind !== "resolved") {
      const reason = !result.blocked && !allowAi
        ? result.reason + " 当前自动化层级不会把模型候选直接写回；切到「自动」后重试。"
        : result.reason
      return { ok: false, reason: reason }
    }
    prepared.push({ ...item, target: result.candidate.target, ui: result.candidate.ui })
    identities.push({
      link: item.link,
      projectRoot: projectRoot,
      pageName: result.pageName,
      item: result.candidate
    })
  }
  return {
    ok: true,
    items: prepared,
    defaults: PIPELINE_A_REQUEST_DEFAULTS,
    identities
  }
}
