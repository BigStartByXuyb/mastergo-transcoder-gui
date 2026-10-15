import { Sparkles } from "lucide-react"

/*
 * AI 补输入的「中间节点」：画在它供料的那一步之前。
 *
 * 流水线是停在那里等人/AI 补输入的，这是流程本身的一环，不是失败的附属说明 ——
 * 所以它出现在步骤之间，而不是挂在某一行的后面。
 */
export function AiFillLine({ filled, note }: { filled: string[]; note?: string }) {
  return (
    <li className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-xs">
      <span className="w-6 shrink-0 text-right tabular-nums">·</span>
      <Sparkles className="size-3.5 shrink-0 text-amber-500" />
      <span className="shrink-0 text-amber-600">AI 补输入</span>
      <span className="min-w-0 flex-1 truncate">{filled.join("、")}</span>
      {note && <span className="shrink-0">{note}</span>}
    </li>
  )
}
