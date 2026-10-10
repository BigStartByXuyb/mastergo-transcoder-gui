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

/*
 * 选好的位图按链接记：链接行没了，那一份图跟着走 —— 暂存件是任务的一部分，不留没人认领的文件。
 * 「哪几行有链接」与解析同一处（lineParts），所以行怎么改都不会算岔。
 */
export function keepPickedImages<T>(images: Record<string, T>, text: string): Record<string, T> {
  const live = new Set(
    text
      .split(/\r?\n/)
      .map((raw) => lineParts(raw).link)
      .filter(Boolean)
  )
  return Object.fromEntries(Object.entries(images).filter(([link]) => live.has(link)))
}
