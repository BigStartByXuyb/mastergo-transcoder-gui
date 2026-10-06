import { toast } from "sonner"

/*
 * 复制一段文本：优先 Clipboard API，不行退回 textarea + execCommand（老浏览器 / 受限环境）。
 * 复制完统一提示一句 —— 界面各处（控件查询、插件页）都调这一处，不各写一遍。
 */

export async function copyText(value: string, label = "") {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const area = document.createElement("textarea")
    area.value = value
    document.body.appendChild(area)
    area.select()
    document.execCommand("copy")
    document.body.removeChild(area)
  }
  toast.success("已复制" + (label ? "：" + label : ""))
}
