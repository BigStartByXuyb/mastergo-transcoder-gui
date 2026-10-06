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
