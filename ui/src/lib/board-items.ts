export type BoardMode = "A" | "B" | "AB"

export type BoardItem = { link: string; target: string; mode: BoardMode }

/*
 * 看板“一行一个任务”的解析：`链接` 或 `链接 | Target`。
 * 空行跳过；没有链接的行跳过；Target 省略时留空由插件按设计稿推导。
 */
export function parseBoardItems(text: string, mode: BoardMode): BoardItem[] {
  const items: BoardItem[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const [linkPart, targetPart] = line.split("|")
    const link = (linkPart ?? "").trim()
    if (!link) continue
    items.push({ link, target: (targetPart ?? "").trim(), mode })
  }
  return items
}

/*
 * 补全结果写回文本：只补还没写 Target 的行，写成 `链接 | Target`；
 * 手写过 Target 的行一律不动 —— 人写的优先。
 */
export function fillTargets(text: string, targets: Map<string, string>): string {
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim()
      if (!line) return raw
      const [linkPart, targetPart] = line.split("|")
      const link = (linkPart ?? "").trim()
      if (!link || (targetPart ?? "").trim()) return raw
      const target = targets.get(link)
      return target ? link + " | " + target : raw
    })
    .join("\n")
}
