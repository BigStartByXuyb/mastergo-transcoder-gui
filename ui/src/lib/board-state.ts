// 任务状态 → 徽标形态：失败/冲突用破坏色，运行中用实心，其余描边。放在这里供看板与流水线共用。
const FAILED_STATES = ["failed", "conflict"]

export function boardStateVariant(state: string): "secondary" | "destructive" | "default" | "outline" {
  if (state === "merged") return "secondary"
  if (FAILED_STATES.includes(state)) return "destructive"
  if (state === "running" || state === "merging") return "default"
  return "outline"
}
