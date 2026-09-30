import { describeFailure } from "@/lib/describe-failure"

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
