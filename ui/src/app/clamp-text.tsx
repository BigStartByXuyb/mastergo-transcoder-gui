import { cn } from "@/lib/utils"

/*
 * 长提示的统一形态：最多三行，超出显示省略号，鼠标悬停看全文（title），文字可选中复制。
 * 提示类文本（失败原因、步骤备注、冲突说明）到处都很长，各写各的截断会让同一句话在不同页面长得不一样；
 * 这里用 -webkit-box + line-clamp 而不是 Tailwind 的 line-clamp-*，省得样式依赖插件版本。
 *
 * 边界：表格/描述里的标识符（工程路径、Target、资源名、文件名）不用它 —— 那些是单 token，
 * 折行不丢信息、截断反而让人看不到全名，按容器宽 break-all 换行即可。
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
