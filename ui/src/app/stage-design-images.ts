import { pickedForLink } from "@/lib/board-items"
import { api, type Board } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { modeTakesRoute } from "@/lib/task-form"
import { fileToBase64 } from "@/lib/upload-files"

/*
 * 新建时先选好的设计稿位图 → 暂存件：一条任务一份，键就是任务 id（后端只有 lib/design-image.js 的
 * stagedPathOf 定这个键），所以选图这一步不必等页面 Target 有值，暂存也只能在任务建出来之后做。
 *
 * 两个新建入口（流水线页的表单、看板的创建任务弹窗）共用这一份编排 —— 过门禁、逐张送、失败怎么说
 * 都在这里，页面那侧只给「哪几行配了哪张图」。A 的页面 PNG 是启动前置输入：暂存失败时由调用方
 * 撤掉刚建的任务，保留表单里的选图，供用户修好后重试。
 */

export type StagedPick = { taskId: string; file: File }
export type StageResult = { ok: boolean; failure: string }

/*
 * 暂存没成时接在后端原话后面的那半句：只有这一处说（两个新建入口都显示同一句）。
 * 它说的是这件事的后果 —— A 任务不会自动启动；用户补一张图后再提交。
 */
export const STAGE_FAILED_NOTE = "（先选的那张图没暂存上，A 任务没有启动；修好后重新提交）"

/*
 * 只有跑 A 路线才读设计稿位图（这条判据在 ui/src/lib/task-form.ts 的 modeTakesRoute）：
 * 选图框露不露读它，送不送也读它 —— 两个新建入口都从这里过，不为「送了也没用」的图留下暂存件。
 */
function routePicks(mode: string, picks: StagedPick[]): StagedPick[] {
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
    const link = linkOf.get(taskId)
    // 取法与单页表单同一处（含「还没填链接」那一格）：这里只看这一条任务自己带的链接。
    const file = link ? pickedForLink(images, link) : null
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

/** 唯一出口：过路线门禁 → 逐张送 → 返回同一句失败原话，由两个入口按各自的失败面显示。 */
export async function stagePickedImages(mode: string, picks: StagedPick[]): Promise<StageResult> {
  const failure = await sendAll(routePicks(mode, picks))
  return { ok: !failure, failure }
}

/** 暂存失败时撤销这一批刚建的任务：队列里不留没有页面 PNG 的 A 任务。 */
export async function discardCreatedTasks(board: Board, taskIds: string[]): Promise<Board> {
  let current = board
  for (const taskId of taskIds) current = (await api.boardRemove(taskId)).board
  return current
}
