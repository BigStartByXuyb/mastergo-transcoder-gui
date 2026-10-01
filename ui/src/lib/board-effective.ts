import type { BoardTask } from "@/lib/api"

/*
 * 一个页面在工程里只有一份是当前生效的：本页最后一次合并成功的那一单。
 * 更早的同类任务，同名文件已经被后一单覆盖掉了，产物不再是工程里的内容。
 *
 * 只比 merged —— 排队、在跑、待合并、冲突都没写进工程（冲突一个字节都不写），不参与比较。
 * 判据一律取后端的 merge.at，界面不自己按 createdAt 猜。
 */

export type Coverage = "effective" | "covered"

/* 页面身份：工程 + Ui 前缀 + 页面名 + 模式。模式也算，A 与 B 写的是两套产物。 */
export function pageKeyOf(task: BoardTask): string {
  const request = task.request
  return [request.projectRoot, request.ui, request.target, request.mode].join("\u0000")
}

/* 任务 id → 生效 / 已被覆盖。没合并过的任务不在表里，调用方按 undefined 当作「未参与」。 */
export function coverageOf(tasks: BoardTask[]): Map<string, Coverage> {
  const latest = new Map<string, { id: string; at: string }>()
  for (const task of tasks) {
    if (task.state !== "merged") continue
    const key = pageKeyOf(task)
    const at = task.merge ? task.merge.at : ""
    const best = latest.get(key)
    if (!best || at > best.at) latest.set(key, { id: task.id, at: at })
  }
  const coverage = new Map<string, Coverage>()
  for (const task of tasks) {
    if (task.state !== "merged") continue
    const best = latest.get(pageKeyOf(task))
    coverage.set(task.id, best && best.id === task.id ? "effective" : "covered")
  }
  return coverage
}

/*
 * 「只看生效」：把被覆盖的挑出去，并告诉调用方藏了几条。
 * 看板与区域页都走它 —— 同一个数在两页各算一遍，就会出现「一处说藏了 N 条、另一处说 M 条」。
 */
export function visibleByCoverage(
  tasks: BoardTask[],
  coverage: Map<string, Coverage>,
  onlyEffective: boolean
): { shown: BoardTask[]; hidden: number } {
  if (!onlyEffective) return { shown: tasks, hidden: 0 }
  const shown = tasks.filter((task) => coverage.get(task.id) !== "covered")
  return { shown: shown, hidden: tasks.length - shown.length }
}
