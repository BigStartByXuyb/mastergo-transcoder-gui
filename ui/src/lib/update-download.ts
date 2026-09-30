import { api, type UpdateStatus } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 发起一次下载：顶上的红点标注与设置页版本表里的「下载」共用这一处。
 * 只把结果交出去（起没起来、要不要说一句、错误是什么），用什么方式提示由调用方决定。
 */

export type DownloadOutcome = {
  started: boolean
  /** 没起来时的说明，例如「已经在下载了」。 */
  note: string
  status: UpdateStatus | null
  error: string
}

export async function startUpdateDownload(version: string): Promise<DownloadOutcome> {
  try {
    const payload = await api.updateStage(version)
    return { started: payload.started, note: payload.note || "", status: payload.status, error: "" }
  } catch (error) {
    return { started: false, note: "", status: null, error: describeFailure(error) }
  }
}
