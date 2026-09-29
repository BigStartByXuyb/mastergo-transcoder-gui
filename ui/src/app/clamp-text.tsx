import { cn } from "@/lib/utils"

/*
 * 长提示的统一形态：最多三行，超出显示省略号，鼠标悬停看全文（title），文字可选中复制。
 * 提示类文本（失败原因、步骤备注、冲突说明）到处都很长，各写各的截断会让同一句话在不同页面长得不一样；
 * 这里用 -webkit-box + line-clamp 而不是 Tailwind 的 line-clamp-*，省得样式依赖插件版本。
 */
export function ClampText({ text, lines = 3, className }: { text: string; lines?: number; className?: string }) {
  if (!text) return null
  return (
    <span
      className={cn("break-all whitespace-pre-wrap", className)}
      title={text}
      style={{ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }}
    >
      {text}
    </span>
  )
}
