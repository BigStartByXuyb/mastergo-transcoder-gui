import { api, type IdentityCandidate } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import type { BoardItem } from "@/lib/board-items"

/*
 * 流水线 A 启动前把页面身份自动落实：先查工程登记表；未登记时从链接取设计页名，
 * 先走机械候选，必要时让模型补语义名，最后写回登记表。B/AB 继续走原有身份流程。
 */

export type PreparedPipelineItem = BoardItem & { ui: string }

export type PreparedPipelineItems =
  | { ok: true; items: PreparedPipelineItem[] }
  | { ok: false; reason: string }

function usable(items: IdentityCandidate[]): IdentityCandidate | null {
  return items.find((item) => Boolean(item.target && item.ui && !item.needsSemanticName)) ?? null
}

async function prepareOne(item: BoardItem, projectRoot: string): Promise<PreparedPipelineItem | string> {
  try {
    const registered = await api.identityCandidates({
      projectRoot,
      pageName: "",
      useAi: false,
      link: item.link
    })
    let picked = registered.blocked ? null : usable(registered.candidates)
    if (picked) {
      return { ...item, target: picked.target, ui: picked.ui }
    }

    let reason = registered.blocked
    let designPageName = ""
    if (!picked) {
      const named = await api.designPageName(item.link)
      designPageName = named.pageName
      const base = { projectRoot, pageName: named.pageName, link: item.link }
      const mechanical = await api.identityCandidates({ ...base, useAi: false })
      picked = mechanical.blocked ? null : usable(mechanical.candidates)
      reason = mechanical.blocked
      if (!picked) {
        const assisted = await api.identityCandidates({ ...base, useAi: true })
        picked = usable([...assisted.ai.items, ...assisted.candidates])
        reason = assisted.blocked
      }
    }
    if (!picked) {
      return reason || "未能自动确定页面 Target 与区域，请检查工程登记表后再试"
    }
    await api.identityApply({
      projectRoot,
      target: picked.target,
      ui: picked.ui,
      link: item.link,
      designPageName: designPageName || picked.designPageName || ""
    })
    return { ...item, target: picked.target, ui: picked.ui }
  } catch (error) {
    return describeFailure(error)
  }
}

/** 逐项准备，避免多页同时改写同一个项目登记表。 */
export async function preparePipelineAItems(
  items: BoardItem[],
  projectRoot: string
): Promise<PreparedPipelineItems> {
  const prepared: PreparedPipelineItem[] = []
  for (const item of items) {
    const result = await prepareOne(item, projectRoot)
    if (typeof result === "string") return { ok: false, reason: result }
    prepared.push(result)
  }
  return { ok: true, items: prepared }
}
