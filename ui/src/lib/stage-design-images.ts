import { api } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { modeTakesRoute } from "@/lib/task-form"
import { fileToBase64 } from "@/lib/upload-files"

/*
 * 新建时先选好的设计稿位图 → 暂存件：一条任务一份，键就是任务 id（后端只有 lib/design-image.js
 * 的 stagedPathOf 定这个键），所以选图这一步不必等页面 Target 有值，暂存也只能在任务建出来之后做。
 * 一张图被后端挡回来（不是 PNG/JPEG、太大）不连累同一批里其余几张：全部送完，把第一条原话回给调用方显示。
 * 图没暂存上不影响任务本身 —— 流水线跑到那一步会在任务详情里问。
 * 两个新建入口（流水线页的表单、看板的创建任务弹窗）共用这一份编排。
 */

export type StagedPick = { taskId: string; file: File }

/*
 * 只有跑 A 路线才读设计稿位图（这条判据在 ui/src/lib/task-form.ts 的 modeTakesRoute）：
 * 选图框露不露读它，送不送也读它 —— 两个新建入口都从这里过，不为「送了也没用」的图留下暂存件。
 */
export function picksForRoute(mode: string, picks: StagedPick[]): StagedPick[] {
  return modeTakesRoute(mode, "A") ? picks : []
}

export async function stageDesignImages(picks: StagedPick[]): Promise<string> {
  let firstFailure = ""
  for (const pick of picks) {
    try {
      await api.stageDesignImage({ taskId: pick.taskId, data: await fileToBase64(pick.file) })
    } catch (error) {
      if (!firstFailure) firstFailure = describeFailure(error)
    }
  }
  return firstFailure
}
