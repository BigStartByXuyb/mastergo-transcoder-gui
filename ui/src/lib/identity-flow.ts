import { api, type IdentityApplyEntry, type IdentityCandidate, type IdentityTargetParts } from "@/lib/api"
import { pickIdentityCandidate } from "@/lib/identity-pick"

/*
 * 页面身份的取数与写入：一处拼输入字段，两条入口共用 ——
 * 新建任务卡片的「自动补 Target / 区域」，与看板弹窗的「按链接补 Target / 区域」。
 * 谁按什么口径取候选、写登记表时带哪些字段（页名怎么沿用）都在这里，别处不再各拼一份。
 */

export type CandidatesInput = {
  link: string
  projectRoot: string
  /** 设计页名：从链接取到的或人填的那一个；空串表示还不知道这一页叫什么。 */
  pageName: string
  /** 人已经在区域框里写了区域时按它算候选。 */
  ui: string
  useAi: boolean
  /** 流水线 A 的无人值守入口：只允许采用项目里唯一、无需改名的既有区域。 */
  autoAdopt?: boolean
}

export type Candidates = {
  items: IdentityCandidate[]
  /** 非空＝后端不许自动采用，原样交给人看。 */
  blocked: string
}

export async function candidatesForLink(input: CandidatesInput): Promise<Candidates> {
  const payload = await api.identityCandidates({
    projectRoot: input.projectRoot.trim(),
    // 设计页名只认「从链接取到 / 人填的」那一个：拿 Target 顶替会让后端把这一页误判成改过名。
    pageName: input.pageName.trim(),
    useAi: input.useAi,
    autoAdopt: input.autoAdopt === true,
    ui: input.ui.trim(),
    link: input.link.trim()
  })
  // 模型按设计页名给的语义名比机械转换更贴近页面本意，排前面。
  return { items: [...(payload.ai.items ?? []), ...(payload.candidates ?? [])], blocked: payload.blocked }
}

export type ApplyIdentityInput = {
  link: string
  projectRoot: string
  pageName: string
  item: IdentityCandidate
}

function applyEntryOf(input: ApplyIdentityInput): IdentityApplyEntry {
  return {
    target: input.item.target,
    ui: input.item.ui,
    // 链接解析只有插件那一份实现，前端不自己拆 URL。
    link: input.link.trim(),
    // 沿用登记过的页时页名常常是空的：这时带上候选里那条，别把登记里的页名抹掉。
    designPageName: input.pageName.trim() || input.item.designPageName || ""
  }
}

/** 把选中的候选写进工程登记表。 */
export async function applyIdentity(input: ApplyIdentityInput): Promise<{ replaced: boolean }> {
  const written = await api.identityApply({
    projectRoot: input.projectRoot.trim(),
    ...applyEntryOf(input)
  })
  return { replaced: written.replaced }
}

/** A 的批次写回：所有条目一次校验、一次落盘；任一条不合法时整批不写。 */
export async function applyIdentities(inputs: ApplyIdentityInput[]): Promise<{ replaced: boolean[] }> {
  if (inputs.length === 0) return { replaced: [] }
  const roots = [...new Set(inputs.map((input) => input.projectRoot.trim()))]
  if (roots.length !== 1 || roots[0] === "") throw new Error("批次里的工程目录必须一致且不能为空")
  const written = await api.identityApplyBatch(roots[0], inputs.map(applyEntryOf))
  return { replaced: written.replaced }
}

/**
 * 提交前的身份对账：人填的 Target 与「链接指向的那一页」是不是同一页。
 *
 * 不是同一页时给回链接指向的那一条候选（登记表里那一页），调用方据此拦下提交 —— 放过去的话，
 * 插件在还没进流水线时就会按身份混搭守卫拒掉（Target 取自一页、layerId 取自另一页）。
 * 判据只认后端标了已登记的候选：机械候选与模型候选都没有登记表身份，不能用来放行另一页的 Target。
 * 没填 Target、或后端没有已登记候选时给 null（那种情况无从对账，交给插件判）。
 */
export function identityConflict(input: { target: string; candidates: IdentityCandidate[] }): IdentityCandidate | null {
  const typed = input.target.trim()
  const registered = input.candidates.filter((item) => item.registered === true)
  if (!typed || registered.length === 0) return null
  if (registered.some((item) => item.target === typed)) return null
  return registered[0]
}

/** 显式 Target 与链接、后端区域拆分、完整性判定的统一结论。 */
export type ExplicitTargetResolution =
  | { kind: "none" }
  | { kind: "picked"; candidate: IdentityCandidate }
  | { kind: "rejected"; reason: string }

/** 人填 Target 与链接指向的登记页冲突时，两个开始入口显示同一句话。 */
export function explicitTargetConflictReason(conflict: IdentityCandidate, typed: string): string {
  return (
    "这个链接指向的页面在登记表里是 " +
    conflict.target +
    (conflict.ui ? "（区域 " + conflict.ui + "）" : "") +
    "，你填的 Target 是 " +
    typed +
    " —— 两者不是同一页，插件会拒绝。请改成链接指向的 Target，或确认链接是否贴错了。"
  )
}

/**
 * A 与 B / AB 的显式 Target 只走这一处：先与链接候选对账，命中登记页就直接采用；
 * 没有命中才读取后端拆分结果并按同一份完整性判据决定能否采用。
 */
export async function resolveExplicitTarget(input: {
  target: string
  candidates: IdentityCandidate[]
  loadTargetParts: (target: string) => Promise<IdentityTargetParts>
  basis: string
}): Promise<ExplicitTargetResolution> {
  const target = input.target.trim()
  if (!target) return { kind: "none" }
  const conflict = identityConflict({ target: target, candidates: input.candidates })
  if (conflict) return { kind: "rejected", reason: explicitTargetConflictReason(conflict, target) }

  const existing = input.candidates.find((candidate) => candidate.target === target)
  const parts = existing ? null : await input.loadTargetParts(target)
  const candidate: IdentityCandidate = existing || {
    target: target,
    ui: parts?.previewUi ?? "",
    semanticName: parts?.semanticName ?? "",
    basis: input.basis,
    needsSemanticName: parts?.complete !== true
  }
  const decision = pickIdentityCandidate([candidate], "")
  return decision.pick
    ? { kind: "picked", candidate: decision.pick }
    : { kind: "rejected", reason: decision.reason }
}
