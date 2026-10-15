import type { IdentityCandidate } from "@/lib/api"

/*
 * Target / UI 区域候选的采用判定。
 *
 * 候选与「能不能自动采用」的判据都在后端（lib/identity.js：只有这一页登记过、页名没变才自动）。
 * 这里只把后端给的 blocked 整句换成结论：非空＝不许自动采用，原样交给人看；
 * 空串时第一条拼好的 Target 就是结论。按钮入口与自动层级启动前共用这一份。
 */

export type IdentityDecision =
  | { pick: IdentityCandidate; reason: "" }
  | { pick: null; reason: string }

const NEEDS_SEMANTIC_NAME =
  "候选里还没有拼好的 Target：语义名要由人给。把「设计页名」填成英文（例如 StopAdjust），" +
  "或在「页面 Target」里直接写 区域+语义名（例如 F1StopAdjust）。"

export function pickIdentityCandidate(list: IdentityCandidate[], blocked: string): IdentityDecision {
  if (blocked) return { pick: null, reason: blocked }
  const pick = list.find((item) => item.target && !item.needsSemanticName)
  if (!pick) return { pick: null, reason: NEEDS_SEMANTIC_NAME }
  return { pick, reason: "" }
}
