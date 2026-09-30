import { api, type UpdateStatus } from "@/lib/api"
import { startDownload, type DownloadResult } from "@/lib/download-run"

/*
 * 程序更新的下载：顶上的红点标注与设置页版本表里的「下载」共用这一处；
 * 「起没起来、要不要说一句」归一到 download-run.ts，各页只管怎么呈现。
 */

export type DownloadOutcome = DownloadResult<UpdateStatus>

export function startUpdateDownload(version: string): Promise<DownloadOutcome> {
  return startDownload(function () {
    return api.updateStage(version)
  })
}
