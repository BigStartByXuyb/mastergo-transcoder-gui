import { toast } from "sonner"

/*
 * 复制一段文本：优先 Clipboard API，不行退回 textarea + execCommand（老浏览器 / 受限环境）。
 * 复制完统一提示一句 —— 界面各处（控件查询、插件页）都调这一处，不各写一遍。
 * 两条路都失败就说没复制成功：说「已复制」而剪贴板里没有，是比复制不了更糟的事。
 */

export async function copyText(value: string, label = "") {
  if (!value) return
  if ((await tryClipboard(value)) || tryExecCommand(value)) {
    toast.success("已复制" + (label ? "：" + label : ""))
    return
  }
  toast.error("没能复制到剪贴板，手动选一下这段文字")
}

async function tryClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

/* 退路：execCommand 的返回值与异常都要看，否则「没复制成功」会被当成成功。 */
function tryExecCommand(value: string): boolean {
  const area = document.createElement("textarea")
  area.value = value
  document.body.appendChild(area)
  try {
    area.select()
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
  }
}
