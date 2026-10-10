import { toast } from "sonner"

import { api, type Board } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { modeTakesRoute } from "@/lib/task-form"
import { fileToBase64 } from "@/lib/upload-files"

/*
 * 新建时先选好的设计稿位图 → 暂存件：一条任务一份，键就是任务 id（后端只有 lib/design-image.js 的
 * stagedPathOf 定这个键），所以选图这一步不必等页面 Target 有值，暂存也只能在任务建出来之后做。
 *
 * 两个新建入口（流水线页的表单、看板的创建任务弹窗）共用这一份编排 —— 过门禁、逐张送、失败怎么说
 * 都在这里，页面那侧只给「哪几行配了哪张图」。图没暂存上不影响任务本身：流水线跑到那一步会在任务详情里问。
 */

export type StagedPick = { taskId: string; file: File }

/*
 * 暂存没成时接在后端原话后面的那半句：只有这一处说（两个新建入口都显示同一句）。
 * 它说的是这件事的后果 —— 图不跟任务走，任务本身照常跑。不提步骤名：吃布局输入的是哪一步由插件契约说
 * （与 ui/src/lib/task-form.ts 的 READ_IMAGE_HINT 同一口径）。
 */
export const STAGE_FAILED_NOTE = "（先选的那张图没暂存上，任务照常跑；图可以在任务详情里再传一张）"

/*
 * 只有跑 A 路线才读设计稿位图（这条判据在 ui/src/lib/task-form.ts 的 modeTakesRoute）：
 * 选图框露不露读它，送不送也读它 —— 两个新建入口都从这里过，不为「送了也没用」的图留下暂存件。
 */
export function picksForRoute(mode: string, picks: StagedPick[]): StagedPick[] {
  return modeTakesRoute(mode, "A") ? picks : []
}

/*
 * 有图的任务就该带上那张图：配图看**任务自己带的链接**（看板快照里的 request.link 就是建它的那一行），
 * 不看建任务的次序 —— 同一个链接出现几次就是同一页，那几份图本来就是同一张。没选图的跳过。
 */
export function picksForCreated(
  board: Board,
  created: string[],
  images: Record<string, File>
): StagedPick[] {
  const linkOf = new Map(board.tasks.map((task) => [task.id, task.request.link]))
  return created.flatMap((taskId) => {
    const file = images[linkOf.get(taskId) ?? ""]
    return file ? [{ taskId, file }] : []
  })
}

/* 逐张送：一张被后端挡回来（不是 PNG/JPEG、太大）不连累其余几张，回第一条原话（没有就是空串）。 */
async function sendAll(picks: StagedPick[]): Promise<string> {
  let firstFailure = ""
  for (const pick of picks) {
    try {
      await api.stageDesignImage({ taskId: pick.taskId, data: await fileToBase64(pick.file) })
    } catch (error) {
      // 后端给的原话（原因 + 怎么修）在最前面，后面补一句这件事的后果。
      if (!firstFailure) firstFailure = describeFailure(error) + STAGE_FAILED_NOTE
    }
  }
  return firstFailure
}

/*
 * 唯一出口：过路线门禁 → 逐张送 → 失败弹一句（不走页内那条「看板没读到最新状态」的提示：
 * 标题对不上这件事，而且轮询一到就清）。不抛错 —— 图没跟上不算这次新建失败。
 */
export async function stagePickedImages(mode: string, picks: StagedPick[]): Promise<void> {
  const failure = await sendAll(picksForRoute(mode, picks))
  if (failure) toast.error(failure)
}
