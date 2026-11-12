/*
 * 行上只给能认出是哪一页的那一段：链接太长，整条铺出来会把这一行挤成一团。
 * 弹窗里两块（补全结果与位图行）都用它，取标签的规则只有这一处。
 */
export function linkLabel(link: string): string {
  const match = /[?&]layer_id=([^&]+)/.exec(link)
  return match ? match[1] : link
}

export type BoardMode = "A" | "B" | "AB"

export type BoardItem = { link: string; target: string; mode: BoardMode }
/** 一行 + 它在文本框里的行号（从 1 起，空行也占一行）：界面上「第 N 行」要能和对上的那一行对得住。 */
export type BoardRow = BoardItem & { line: number }

/* 一行 → 链接与 Target（没有链接时 link 是空串）：拆一行的规则只有这一处。 */
function lineParts(raw: string): { link: string; target: string } {
  const [linkPart, targetPart] = raw.trim().split("|")
  return { link: (linkPart ?? "").trim(), target: (targetPart ?? "").trim() }
}

/*
 * 看板“一行一个任务”的解析：`链接` 或 `链接 | Target`，带回行号。
 * 空行跳过；没有链接的行跳过；Target 省略时留空由插件按设计稿推导。
 */
export function parseBoardRows(text: string, mode: BoardMode): BoardRow[] {
  const rows: BoardRow[] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const { link, target } = lineParts(raw)
    if (!link) return
    rows.push({ link, target, mode, line: index + 1 })
  })
  return rows
}

/** 只要「有几行、每行是什么」的场合用这一份（行号不带出去）。 */
export function parseBoardItems(text: string, mode: BoardMode): BoardItem[] {
  return parseBoardRows(text, mode).map((row) => ({ link: row.link, target: row.target, mode: row.mode }))
}

/*
 * 补全结果写回文本：只补还没写 Target 的行，写成 `链接 | Target`；
 * 手写过 Target 的行一律不动 —— 人写的优先。
 */
export function fillTargets(text: string, targets: Map<string, string>): string {
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const { link, target: given } = lineParts(raw)
      if (!link || given) return raw
      const target = targets.get(link)
      return target ? link + " | " + target : raw
    })
    .join("\n")
}

/* 还没填链接时选的那一份记在这一格（键是空串）：链接一填上就归那一页。 */
const UNCLAIMED = ""

/* 页面 PNG 的键只认去掉首尾空白的链接；选图、取图、换链接时保留图片共用这一条。 */
function imageKey(link: string): string {
  return link.trim()
}

/*
 * 选好的位图按链接记：链接行没了，那一份图跟着走 —— 暂存件是任务的一部分，不留没人认领的文件。
 * 「哪几行有链接」与解析同一处（lineParts），所以行怎么改都不会算岔。
 * 空链接那一格是「选的时候还没填链接」：这里不拆 URL，保持待认领；
 * 当前表单只有一个页面时，读取与提交阶段把它当作这一页的图。
 */
export function keepPickedImages<T>(images: Record<string, T>, text: string): Record<string, T> {
  const live = new Set<string>([UNCLAIMED])
  for (const raw of text.split(/\r?\n/)) {
    const link = lineParts(raw).link
    if (link) live.add(imageKey(link))
  }
  return Object.fromEntries(Object.entries(images).filter(([link]) => live.has(link)))
}

/*
 * 选好的位图按链接记：置入或移除一张 —— 记录长什么样、怎么清只在这一处维护。
 * 「待认领」那一格只有一份：这一份要么归当前链接，要么占用它（链接还空着时）；置入或移除都先清掉它，
 * 所以移除之后不会又从那一格里冒出来。两个入口共用：看板弹窗每行一个框，流水线页只有当前链接那一个键。
 */
export function withPickedImage<T>(images: Record<string, T>, link: string, file: T | null): Record<string, T> {
  const next = { ...images }
  const key = imageKey(link)
  delete next[UNCLAIMED]
  delete next[key]
  // 链接还空着时 link 就是 UNCLAIMED 那一格：这一份先记在待认领处，链接一填就归那一页。
  if (file) next[key] = file
  return next
}

/*
 * 这一页现在的图：先按链接取。allowUnclaimed 只在当前表单确实只有一个页面时打开，
 * 让「先选图、后填链接」那一份仍能显示与提交；多页面时待认领图不落到任意一页。
 */
export function pickedForLink<T>(images: Record<string, T>, link: string, allowUnclaimed = false): T | null {
  const key = imageKey(link)
  if (key && images[key] != null) return images[key]
  return !key || allowUnclaimed ? images[UNCLAIMED] ?? null : null
}
