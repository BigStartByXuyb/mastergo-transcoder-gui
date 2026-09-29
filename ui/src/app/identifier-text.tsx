import { cn } from "@/lib/utils"

/*
 * 标识符（工程路径、Target、资源名、文件名、日志路径）：单 token，按容器宽折行、title 给全文，不截断。
 * 与 ClampText 的分工写在各自文件里：提示句要三行截断，标识符截断反而看不到全名。
 */
export function IdentifierText({ text, className }: { text: string; className?: string }) {
  if (!text) return null
  return (
    <span className={cn("break-all font-mono", className)} title={text}>
      {text}
    </span>
  )
}
