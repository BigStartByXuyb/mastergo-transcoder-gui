import { describeFailure } from "@/lib/describe-failure"

/*
 * 「发起一次下载」的结果归一：程序更新、Codex、运行时、插件安装四条线都是同一个形状
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
 * 按 kind 分派：失败写红字、本来就有就说一句、真下起来了交给调用方。
 * 这里只分派，不碰状态也不弹提示 —— 怎么呈现是各页的事，lib 这层不依赖展示框架。
 */
export function applyDownload<TStatus>(
  result: DownloadResult<TStatus>,
  handlers: {
    setFailure: (message: string) => void
    onAlready: (message: string) => void
    onStarted?: () => void
  }
): void {
  if (result.kind === "failed") handlers.setFailure(result.message)
  else if (result.kind === "already") handlers.onAlready(result.message)
  else if (handlers.onStarted) handlers.onStarted()
}
