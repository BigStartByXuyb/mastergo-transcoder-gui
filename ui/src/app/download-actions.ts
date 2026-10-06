import { toast } from "sonner"

import { applyDownload, type DownloadResult } from "@/lib/download-run"

/*
 * 四条下载线（程序更新 / Codex / 运行时 / 插件安装）的统一落地：套用返回的状态、失败写红字、
 * 「本地已经有这一份」提示一句、真下起来了交给调用方。
 *
 * 放在 app 层而不是 lib：默认提示要用 toast，lib 那层不认识展示框架；
 * 各页只传自己的差异（更新线 started 要报「正在下载 vX」，顶栏要跳更新页）。
 */

export function finishDownload<TStatus>(
  result: DownloadResult<TStatus>,
  handlers: {
    setFailure: (message: string) => void
    setStatus?: (status: TStatus) => void
    onAlready?: (message: string) => void
    onStarted?: () => void
  }
): void {
  if (handlers.setStatus && result.status) handlers.setStatus(result.status)
  applyDownload(result, {
    setFailure: handlers.setFailure,
    onAlready: handlers.onAlready ?? ((message) => toast.info(message)),
    onStarted: handlers.onStarted
  })
}
