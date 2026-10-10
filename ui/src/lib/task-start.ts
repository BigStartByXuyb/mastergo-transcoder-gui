import type { IdentityCandidate } from "@/lib/api"
import { identityConflict } from "@/lib/identity-flow"
import { adoptsIdentityWithoutConfirm } from "@/lib/task-form"

/*
 * 开始一条任务之前的身份决定：拿最终要提交的 Target / 区域，或者一句「为什么不能开始」。
 *
 * 两件事，顺序固定：
 *   1. 人填了 Target 就先与链接对账 —— 两者必须指向登记表里的同一页，否则插件会在还没进流水线时
 *      按身份混搭守卫拒掉（那一步连步骤都没有，人只能对着「没跑起来」猜）。
 *   2. 一个身份字段都没填、且自动化层级允许时，自动补一次（与表单那个按钮同一条实现）。
 *
 * 取候选、自动补、写登记表都由调用方注入 —— 这里只编排顺序与判据，副作用仍在各自的实现里。
 */

export type StartDecision =
  | { ok: true; target: string; ui: string }
  /** 不能开始：reason 有值就照它显示；没值表示原因已经由被注入的那条路写下了（例如身份补全自己报的）。 */
  | { ok: false; reason?: string }

export function conflictReason(conflict: IdentityCandidate, typed: string): string {
  return (
    "这个链接指向的页面在登记表里是 " +
    conflict.target +
    (conflict.ui ? "（区域 " + conflict.ui + "）" : "") +
    "，你填的 Target 是 " +
    typed +
    " —— 两者不是同一页，插件会拒绝。点「自动补 Target / 区域」会用登记表里的那一个；或确认链接是不是贴错了。"
  );
}

export async function decideStartIdentity(input: {
  link: string
  projectRoot: string
  target: string
  ui: string
  automation: string
  /** 链接指向那一页的候选（后端按链接 + 登记表给；前端不自己拆链接）。 */
  loadCandidates: () => Promise<IdentityCandidate[]>
  /** 缺身份时的自动补全（与表单按钮同一条实现）。 */
  autoPick: () => Promise<IdentityCandidate | null>
  autoApply: (item: IdentityCandidate) => Promise<void>
}): Promise<StartDecision> {
  let target = input.target.trim()
  let ui = input.ui.trim()

  if (target && input.link.trim() && input.projectRoot.trim()) {
    const conflict = identityConflict({ target: target, candidates: await input.loadCandidates() })
    if (conflict) return { ok: false, reason: conflictReason(conflict, target) }
  }

  if (!target && !ui && adoptsIdentityWithoutConfirm(input.automation)) {
    const picked = await input.autoPick()
    // 补不出来：原因由那条实现写下了（它知道自己为什么停），这里不再盖一句。
    if (!picked) return { ok: false }
    await input.autoApply(picked)
    target = picked.target
    ui = picked.ui
  }

  return { ok: true, target: target, ui: ui }
}
