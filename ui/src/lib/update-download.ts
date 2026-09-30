import { api, type UpdateStatus } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 发起一次下载：顶上的红点标注与设置页版本表里的「下载」共用这一处。
 * 只把结果交出去（起没起来、要不要说一句、错误是什么），用什么方式提示由调用方决定。
 */

export type DownloadOutcome = {
  /** started：真下起来了；already：本机已经有这一版；failed：没起来（message 是原因）。 */
  kind: "started" | "already" | "failed"
  /** 给用户的一句话：already 说「本地已经有这一版」，failed 说原因，started 为空。 */
  message: string
  status: UpdateStatus | null
}

export async function startUpdateDownload(version: string): Promise<DownloadOutcome> {
  try {
    const payload = await api.updateStage(version)
    if (payload.started) return { kind: "started", message: "", status: payload.status }
    return { kind: "already", message: payload.note || "本地已经有这一版", status: payload.status }
  } catch (error) {
    return { kind: "failed", message: describeFailure(error), status: null }
  }
}
