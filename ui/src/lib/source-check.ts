/*
 * 「保存并检查」之后要显示的两句话：失败给原因、成功给结论。
 *
 * 程序更新与插件（流水线）两半都从同一处发布源取，检查结果也都回在这个弹窗里，形状只留这一处；
 * 「怎么措辞」仍归各自那条线（describeUpdate / describePluginInstall），这里只决定放哪一格。
 */

export type SourceCheckOutcome = { failure: string; note: string }

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
