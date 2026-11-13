/*
 * 待确认面板的来源键：两个挂载点在来源、工程、页面、路线、任务或运行变化时都重建面板。
 * 面板内的命名、译文与术语草稿按当前来源存活，本文件只算键，不读取待确认清单。
 */

export type PendingPanelSource = {
  source: string
  projectRoot: string
  target: string
  mode: string
  taskId: string
  runId: string
}

export function pendingPanelKey(entry: PendingPanelSource) {
  return JSON.stringify([
    entry.source,
    entry.projectRoot,
    entry.target,
    entry.mode,
    entry.taskId,
    entry.runId
  ])
}
