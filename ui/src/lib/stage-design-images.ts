import { api } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { fileToBase64 } from "@/lib/upload-files"

/*
 * 新建时先选好的设计稿位图 → 暂存件：一条任务一份，键就是任务 id（后端只有 lib/design-image.js
 * 的 stagedPathOf 定这个键），所以选图这一步不必等页面 Target 有值，暂存也只能在任务建出来之后做。
 * 暂存不上的第一条原话回给调用方显示；图没暂存上不影响任务本身 —— 流水线跑到那一步会在任务详情里问。
 * 两个新建入口（流水线页的表单、看板的创建任务弹窗）共用这一份编排。
 */

export type StagedPick = { taskId: string; file: File }

export async function stageDesignImages(picks: StagedPick[]): Promise<string> {
  for (const pick of picks) {
    try {
      await api.stageDesignImage({ taskId: pick.taskId, data: await fileToBase64(pick.file) })
    } catch (error) {
      return describeFailure(error)
    }
  }
  return ""
}
