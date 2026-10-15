import { api, type IdentityCandidate } from "@/lib/api"

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
    ui: input.ui.trim(),
    link: input.link.trim()
  })
  // 模型按设计页名给的语义名比机械转换更贴近页面本意，排前面。
  return { items: [...(payload.ai.items ?? []), ...(payload.candidates ?? [])], blocked: payload.blocked }
}

/** 把选中的候选写进工程登记表。 */
export async function applyIdentity(input: {
  link: string
  projectRoot: string
  pageName: string
  item: IdentityCandidate
}): Promise<{ replaced: boolean }> {
  const written = await api.identityApply({
    projectRoot: input.projectRoot.trim(),
    target: input.item.target,
    ui: input.item.ui,
    // 链接解析只有插件那一份实现，前端不自己拆 URL。
    link: input.link.trim(),
    // 沿用登记过的页时页名常常是空的：这时带上候选里那条，别把登记里的页名抹掉。
    designPageName: input.pageName.trim() || input.item.designPageName || ""
  })
  return { replaced: written.replaced }
}

/**
 * 提交前的身份对账：人填的 Target 与「链接指向的那一页」是不是同一页。
 *
 * 不是同一页时给回链接指向的那一条候选（登记表里那一页），调用方据此拦下提交 —— 放过去的话，
 * 插件在还没进流水线时就会按身份混搭守卫拒掉（Target 取自一页、layerId 取自另一页）。
 * 判据只用后端给的候选：前端不自己拆链接，也不自己推页面身份。
 * 没填 Target、或后端一条候选都给不出时给 null（那种情况无从对账，交给插件判）。
 */
export function identityConflict(input: { target: string; candidates: IdentityCandidate[] }): IdentityCandidate | null {
  const typed = input.target.trim()
  if (!typed || input.candidates.length === 0) return null
  if (input.candidates.some((item) => item.target === typed)) return null
  return input.candidates[0]
}
