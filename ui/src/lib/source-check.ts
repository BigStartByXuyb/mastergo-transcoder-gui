/*
 * 「改发布源」这个弹窗的两件事，两半共用：
 *   它的「现状」（发布源那两格）与「保存并检查」要显示的两句话（失败给原因、成功给结论）。
 *
 * 程序更新与插件（流水线）两半都从同一处发布源取，检查结果也都回在这个弹窗里，形状只留这一处；
 * 「怎么措辞」仍归各自那条线（describeUpdate / describePluginInstall），这里只决定放哪一格。
 */

import type { UpdateSource } from "@/lib/api"

export type SourceCheckOutcome = { failure: string; note: string }

/** 改发布源那个弹窗要的「现状」：发布源那两格（两半各自的状态里取）。 */
export type SourceView = { source: UpdateSource; hasToken: boolean }

/**
 * 「保存并检查」那条路要的现状：轮询那一跳没取到就照实报错（不静默）。
 * 两半的取数都经 `useStatusPoll` 的 `reload`，拿不到的情形也一致，所以这一句只写这里。
 */
export function requireStatus<T>(payload: T | null, what: string): T {
  if (!payload) throw new Error("读不到" + what)
  return payload
}

/** 从这条线自己的状态里取弹窗要的那两格。 */
export function sourceViewOf(source: UpdateSource, hasToken: boolean): SourceView {
  return { source: source, hasToken: hasToken }
}

export function sourceCheckOutcome(summary: { label: string; note: string }, failed: boolean): SourceCheckOutcome {
  if (failed) return { failure: summary.note, note: "" }
  return { failure: "", note: summary.note ? summary.label + "；" + summary.note : summary.label }
}

/** 这一次压根没拿到结果（动作骨架抛了）：原因就是刚才那一步写下的那句话。 */
export function sourceCheckDropped(failure: string): SourceCheckOutcome {
  return { failure: failure, note: "" }
}

/**
 * 「保存并检查」那一下的收尾：拿到结果就按这一条线的口径说，没拿到（骨架抛了）就用刚才记住的那句原因。
 * 两半的差别只有 summaryOf 与 failed 两个入参 —— 记忆与成型都走这一处，时机不会各写各的。
 */
export function sourceCheckOutcomeOf<T>(
  payload: { status: T } | null,
  failure: string,
  summaryOf: (status: T) => { label: string; note: string },
  failed: (status: T) => boolean
): SourceCheckOutcome {
  if (!payload) return sourceCheckDropped(failure)
  return sourceCheckOutcome(summaryOf(payload.status), failed(payload.status))
}
