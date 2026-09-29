import type { IdentityCandidate } from "@/lib/api"

/*
 * Target / UI 区域候选的采用判定。
 *
 * 候选由后端（项目既有约定 + 设计页名 + 可选模型）算出，这里只回答一个问题：
 * 能不能自动采用第一条。判不出来就必须给出「人要做什么」，所以判定与文案在同一处，
 * 按钮入口与自动层级启动前共用一份结论。
 */

export type IdentityDecision =
  | { pick: IdentityCandidate; reason: "" }
  | { pick: null; reason: string }

const NO_REGISTRY =
  "这个工程还没有任何区域约定（登记表里没有页面、也没有带前缀的 Target）。"
  + "区域是团队对项目的约定，设计稿里没有这条信息，所以第一次要人给一次："
  + "在「UI 区域」里填一个区域前缀（例如 F1），再点「自动补 Target / 区域」；"
  + "给过就写进该工程的 docs/page-registry.json，之后同一页全自动。"

const AMBIGUOUS =
  "这个设计文件里登记过的区域不是恰好一个（可能还没有先例，也可能出现了 F1/F3 这种分歧）："
  + "不敢替你猜，请在候选里点一下这一页的区域，确认后这一页以后就自动了。"

const NEEDS_SEMANTIC_NAME =
  "候选里还没有拼好的 Target，需要先给语义名（或把自动化层级降到辅助，手工确认一次）。"

export function pickIdentityCandidate(list: IdentityCandidate[], ambiguous: boolean): IdentityDecision {
  const pick =
    list.find((item) => item.target && !item.needsSemanticName) ?? list.find((item) => item.target) ?? null
  if (pick && !ambiguous) return { pick, reason: "" }
  if (list.length === 0) return { pick: null, reason: NO_REGISTRY }
  return { pick: null, reason: ambiguous ? AMBIGUOUS : NEEDS_SEMANTIC_NAME }
}
