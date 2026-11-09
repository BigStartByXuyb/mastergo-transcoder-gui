import { api } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import type { BoardItem } from "@/lib/board-items"
import { applyIdentity, candidatesForLink } from "@/lib/identity-flow"
import { pickIdentityCandidate } from "@/lib/identity-pick"

/*
 * 流水线 A 启动前把页面身份自动落实：取数与写回走 identity-flow，采用判定走 identity-pick。
 * 先走机械候选，必要时让模型补语义名；后端 blocked 时停回调用方。B/AB 继续走原有身份流程。
 */

export type PreparedPipelineItem = BoardItem & { ui: string }

export type PreparedPipelineItems =
  | { ok: true; items: PreparedPipelineItem[] }
  | { ok: false; reason: string }

async function prepareOne(item: BoardItem, projectRoot: string, useAi: boolean): Promise<PreparedPipelineItem | string> {
  try {
    if (item.target.trim()) {
      return "流水线 A 只收 MasterGo 链接；`链接 | Target` 只用于 B / AB。请删掉 A 行的 Target 后重试。"
    }
    const named = await api.designPageName(item.link)
    const base = { link: item.link, projectRoot, pageName: named.pageName, ui: "" }
    let got = await candidatesForLink({ ...base, useAi: false, autoAdopt: true })
    let decision = pickIdentityCandidate(got.items, got.blocked, { autoOnly: true })
    if (!decision.pick && !got.blocked && useAi) {
      got = await candidatesForLink({ ...base, useAi: true, autoAdopt: true })
      decision = pickIdentityCandidate(got.items, got.blocked, { autoOnly: true })
    }
    if (!decision.pick) return decision.reason
    await applyIdentity({ ...base, item: decision.pick })
    return { ...item, target: decision.pick.target, ui: decision.pick.ui }
  } catch (error) {
    return describeFailure(error)
  }
}

/** 逐项准备，避免多页同时改写同一个项目登记表。 */
export async function preparePipelineAItems(
  items: BoardItem[],
  projectRoot: string,
  options: { useAi: boolean }
): Promise<PreparedPipelineItems> {
  const prepared: PreparedPipelineItem[] = []
  for (const item of items) {
    const result = await prepareOne(item, projectRoot, options.useAi)
    if (typeof result === "string") return { ok: false, reason: result }
    prepared.push(result)
  }
  return { ok: true, items: prepared }
}
