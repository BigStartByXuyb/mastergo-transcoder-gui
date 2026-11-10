import { pickedForLink } from "@/lib/board-items"
import { api, type Board } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { fileToBase64 } from "@/lib/upload-files"

/*
 * 新建时先选好的设计稿位图 → 暂存件：一条任务一份，键就是任务 id（后端只有 lib/design-image.js 的
 * stagedPathOf 定这个键），所以选图这一步不必等页面 Target 有值，暂存也只能在任务建出来之后做。
 *
 * 两个新建入口（流水线页的表单、看板的创建任务弹窗）共用这一份编排 —— 建任务、暂存、失败回滚、
 * 显式启动与失败后的看板重读都在这里，页面那侧只给「哪几行配了哪张图」。
 */

type StagedPick = { taskId: string; file: File }
export type CreatedTasks = { board: Board; created: string[] }
export type CreateTasksResult =
  | { ok: true; board: Board; created: string[] }
  | { ok: false; failure: string; board: Board | null; created?: string[] }

export type TaskCreationApi = {
  stageDesignImage: (body: { taskId: string; data: string }) => Promise<{ ok: true }>
  boardStart: (taskId?: string) => Promise<{ board: Board }>
  boardRemove: (taskId: string) => Promise<{ board: Board }>
  board: () => Promise<{ board: Board }>
}

/*
 * 暂存没成时接在后端原话后面的那半句：只有这一处说（两个新建入口都显示同一句）。
 * 它只在回滚确实成功后使用：刚建的任务已撤销；用户补一张图后再提交。
 */
const ROLLBACK_OUTCOME = "刚建的任务已撤销；修好后重新提交"
export const STAGE_FAILED_NOTE = "（先选的那张图没暂存上，" + ROLLBACK_OUTCOME + "）"
export const ROLLED_BACK_NOTE = "（" + ROLLBACK_OUTCOME + "）"
const PAGE_IMAGE_REQUIRED = "含 A 的路线需要为每个页面选择页面 PNG"

/** 页面 PNG 是含 A 路线的硬前置：创建入口在身份准备前也复用这一条。 */
export function pageImageFailure(
  takesPageImage: boolean,
  links: string[],
  images: Record<string, File>
): string {
  return takesPageImage && links.some((link) => !pickedForLink(images, link)) ? PAGE_IMAGE_REQUIRED : ""
}

function startFailedNote(taskIds: string[]): string {
  return "（本批任务仍保留在看板：" + taskIds.join("、") +
    "；已启动成功的会继续跑，未启动的需手动启动或移除）"
}

/*
 * 只有后端路线能力标记需要页面 PNG 时才送图；选图框露不露与这里读同一份 takesPageImage。
 */
function routePicks(takesPageImage: boolean, picks: StagedPick[]): StagedPick[] {
  return takesPageImage ? picks : []
}

/*
 * 有图的任务就该带上那张图：配图看**任务自己带的链接**（看板快照里的 request.link 就是建它的那一行），
 * 不看建任务的次序 —— 同一个链接出现几次就是同一页，那几份图本来就是同一张。没选图的跳过。
 */
function picksForCreated(
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

/*
 * 逐张送：先把每一张都送完，保留第一条后端原话，让用户一次看到所有需要修的问题。
 * 任一张失败时由下面的统一编排按批次回滚，不留下半批已启动的 A 段任务。
 */
async function sendAll(apiClient: TaskCreationApi, picks: StagedPick[]): Promise<string> {
  let firstFailure = ""
  for (const pick of picks) {
    try {
      await apiClient.stageDesignImage({ taskId: pick.taskId, data: await fileToBase64(pick.file) })
    } catch (error) {
      if (!firstFailure) firstFailure = describeFailure(error)
    }
  }
  return firstFailure
}

async function discardCreatedTasks(
  apiClient: TaskCreationApi,
  board: Board,
  taskIds: string[]
): Promise<{ board: Board; failure: unknown | null }> {
  let current = board
  let failure: unknown | null = null
  for (const taskId of taskIds) {
    try {
      current = (await apiClient.boardRemove(taskId)).board
    } catch (error) {
      if (failure == null) failure = error
    }
  }
  return { board: current, failure }
}

async function reloadBoard(apiClient: TaskCreationApi): Promise<Board | null> {
  try {
    return (await apiClient.board()).board
  } catch {
    return null
  }
}

async function rollbackCreation(
  apiClient: TaskCreationApi,
  created: CreatedTasks,
  failure: string,
  note: string
): Promise<CreateTasksResult> {
  const rollback = await discardCreatedTasks(apiClient, created.board, created.created)
  const refreshed = await reloadBoard(apiClient)
  const consequence = rollback.failure == null
    ? note
    : "（撤销刚建任务失败：" + describeFailure(rollback.failure) + (refreshed ? "；看板已重新读取" : "") + "）"
  return {
    ok: false,
    failure: failure + consequence,
    board: refreshed ?? (rollback.failure == null ? rollback.board : null)
  }
}

/**
 * 唯一出口：缺图预检 → 建任务 → 暂存页面 PNG（只对含 A 的路线）→ 创建事务收尾 → 失败整批回滚 → 逐条显式启动。
 * 启动中途失败也把所有刚建任务都尝试一遍，再回读服务端看板，避免半批任务停在延后启动态。
 */
export async function createTasksWithPageImages(input: {
  takesPageImage: boolean
  links: string[]
  images: Record<string, File>
  add: () => Promise<CreatedTasks>
  /** 任务与页面 PNG 都已落地后、启动前的必要写回；失败会连同刚建任务一起撤销。 */
  beforeStart?: () => Promise<void>
  api?: TaskCreationApi
}): Promise<CreateTasksResult> {
  const apiClient = input.api ?? api
  const missingImage = pageImageFailure(input.takesPageImage, input.links, input.images)
  if (missingImage) return { ok: false, failure: missingImage, board: null }
  const created = await input.add()
  const picks = routePicks(input.takesPageImage, picksForCreated(created.board, created.created, input.images))
  const stageFailure = await sendAll(apiClient, picks)
  if (stageFailure) {
    return rollbackCreation(apiClient, created, stageFailure, STAGE_FAILED_NOTE)
  }
  if (input.beforeStart) {
    try {
      await input.beforeStart()
    }
    catch (error) {
      return rollbackCreation(apiClient, created, describeFailure(error), ROLLED_BACK_NOTE)
    }
  }

  let current = created.board
  let firstStartFailure = ""
  for (const taskId of created.created) {
    try {
      current = (await apiClient.boardStart(taskId)).board
    } catch (error) {
      if (!firstStartFailure) firstStartFailure = describeFailure(error)
    }
  }
  if (firstStartFailure) {
    return {
      ok: false,
      failure: firstStartFailure + startFailedNote(created.created),
      board: await reloadBoard(apiClient),
      created: created.created
    }
  }
  return { ok: true, board: current, created: created.created }
}
