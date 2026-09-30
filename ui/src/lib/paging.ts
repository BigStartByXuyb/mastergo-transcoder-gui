/*
 * 分页：一屏放得下就别往下拖。页数、切片、页码夹取只有这一处实现，
 * 版本列表与看板任务表共用它。
 */

export function pageCount(total: number, size: number): number {
  if (size <= 0) return 1
  return Math.max(1, Math.ceil(Math.max(0, total) / size))
}

/** 页码一律夹在有效范围内：数据变少（删了任务、切了筛选）时不会停在空页上。 */
export function clampPage(page: number, total: number, size: number): number {
  const pages = pageCount(total, size)
  if (!Number.isFinite(page)) return 1
  return Math.min(Math.max(1, Math.floor(page)), pages)
}

export function pageSlice<T>(items: T[], page: number, size: number): T[] {
  if (size <= 0) return items
  const current = clampPage(page, items.length, size)
  const start = (current - 1) * size
  return items.slice(start, start + size)
}
