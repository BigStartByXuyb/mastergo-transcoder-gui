import { toast } from "sonner"

import { api } from "@/lib/api"
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
 * 它说的是这件事的后果 —— 图不跟任务走，任务本身照常跑。
 */
export const STAGE_FAILED_NOTE = "（先选的那张图没暂存上，任务照常跑；图可以在任务详情「布局」那一步再传）"

/*
 * 只有跑 A 路线才读设计稿位图（这条判据在 ui/src/lib/task-form.ts 的 modeTakesRoute）：
 * 选图框露不露读它，送不送也读它 —— 两个新建入口都从这里过，不为「送了也没用」的图留下暂存件。
 */
export function picksForRoute(mode: string, picks: StagedPick[]): StagedPick[] {
  return modeTakesRoute(mode, "A") ? picks : []
}

/*
 * 一行对一条任务：看板建任务时按 items 逐条建（lib/board.js 的 add），created 与 items 同一个次序，
 * 所以第 i 行的图就是第 i 条任务的。没选图的行、没建出来的任务都跳过。
 */
export function picksForCreated(
  items: { link: string }[],
  created: string[],
  images: Record<string, File>
): StagedPick[] {
  return items.flatMap((item, index) => {
    const file = images[item.link]
    const taskId = created[index] ?? ""
    return file && taskId ? [{ taskId, file }] : []
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
