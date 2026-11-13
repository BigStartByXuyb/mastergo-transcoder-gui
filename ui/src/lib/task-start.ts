import type { BoardTask, IdentityCandidate } from "@/lib/api"
import { adoptsIdentityWithoutConfirm } from "@/lib/task-form"

/*
 * 开始一条任务之前的身份决定：拿最终要提交的 Target / 区域，或者一句「为什么不能开始」。
 *
 * 一个身份字段都没填、且自动化层级允许时，自动补一次（与表单那个按钮同一条实现）。
 * 人在创建任务时填写的 Target 由 task-creation-entry 的共同入口对账；这里不另留一份实现。
 *
 * 自动补与写登记表都由调用方注入 —— 这里只编排判据，副作用仍在各自的实现里。
 */

export type StartDecision =
  | { ok: true; target: string; ui: string }
  /** 不能开始：reason 有值就照它显示；没值表示原因已经由被注入的那条路写下了（例如身份补全自己报的）。 */
  | { ok: false; reason?: string }

export type IdentityApplyDecision =
  | { ok: true }
  | { ok: false; reason: string }

export async function decideStartIdentity(input: {
  link: string
  projectRoot: string
  target: string
  ui: string
  automation: string
  /** 缺身份时的自动补全（与表单按钮同一条实现）。 */
  autoPick: () => Promise<IdentityCandidate | null>
  autoApply: (item: IdentityCandidate) => Promise<IdentityApplyDecision>
}): Promise<StartDecision> {
  let target = input.target.trim()
  let ui = input.ui.trim()

  if (!target && !ui && adoptsIdentityWithoutConfirm(input.automation)) {
    const picked = await input.autoPick()
    // 补不出来：原因由那条实现写下了（它知道自己为什么停），这里不再盖一句。
    if (!picked) return { ok: false }
    const applied = await input.autoApply(picked)
    if (!applied.ok) return applied
    target = picked.target
    ui = picked.ui
  }

  return { ok: true, target: target, ui: ui }
}

/** 「启动全部」只启动后端 pump() 真会启动的排队任务，延后启动项不在这里越过。 */
export function canStartAll(tasks: Pick<BoardTask, "state" | "deferStart">[]): boolean {
  return tasks.some((task) => task.state === "queued" && !task.deferStart)
}
