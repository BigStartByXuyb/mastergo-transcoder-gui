import { describeFailure } from "@/lib/describe-failure"
import { toast } from "sonner"

/*
 * 「发起一次下载」的结果归一：程序更新、Codex、运行时三条线都是同一个形状
 * （后端回 { started, note, status }），前台不该各写一遍「起没起来、要不要说一句」。
 *
 * kind：started 真下起来了 / already 本地已经有这一份 / failed 没起来（message 是原因）。
 * 各页只决定怎么呈现（toast、红字、要不要跳页）。
 */

export type DownloadResult<TStatus> = {
  kind: "started" | "already" | "failed"
  message: string
  status: TStatus | null
}

export async function startDownload<TStatus>(
  start: () => Promise<{ started: boolean; note: string; status: TStatus }>
): Promise<DownloadResult<TStatus>> {
  try {
    const payload = await start()
    if (payload.started) return { kind: "started", message: "", status: payload.status }
    return { kind: "already", message: payload.note || "本地已经有这一份", status: payload.status }
  } catch (error) {
    return { kind: "failed", message: describeFailure(error), status: null }
  }
}

/*
 * 拿到结果之后的默认处理：套用状态 → failed 写红字 → already 提示一句 → started 交给调用方（有的话）。
 * 各页只覆盖自己的差异（更新线 started 要报「正在下载 vX」，顶栏要跳更新页），不再各写一遍分支。
 */
export function applyDownload<TStatus>(
  result: DownloadResult<TStatus>,
  handlers: {
    setStatus: (status: TStatus) => void
    setFailure: (message: string) => void
    onStarted?: () => void
    onAlready?: (message: string) => void
  }
): void {
  if (result.status) handlers.setStatus(result.status)
  if (result.kind === "failed") handlers.setFailure(result.message)
  else if (result.kind === "already") (handlers.onAlready ?? toast.info)(result.message)
  else if (handlers.onStarted) handlers.onStarted()
}
