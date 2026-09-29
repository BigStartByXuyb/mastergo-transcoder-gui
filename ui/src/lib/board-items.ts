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
