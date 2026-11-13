import { startPipelineA } from "@/app/start-pipeline-a"
import {
  createTasksWithPageImages,
  pageImageFailure,
  type CreateTasksResult,
  type CreatedTasks,
  type TaskCreationApi
} from "@/app/stage-design-images"
import type { BoardAddBody, BoardModePolicy } from "@/lib/api"
import { singlePageAllowsUnclaimedImage, type BoardItem } from "@/lib/board-items"

/*
 * 两个新建入口共用这一层：先按同一套输入判据给失败原因，再按后端路线能力选择
 * A 的自动身份编排或 B / AB 的请求准备。页面只保留表单状态、错误呈现与跳转。
 */

export function taskEntryFailure(input: {
  projectRoot: string
  links: string[]
  modes: BoardModePolicy[] | undefined
  policy: BoardModePolicy | null
}): string {
  const inputFailure = taskInputFailure(input)
  if (inputFailure) return inputFailure
  if (!input.policy) {
    return Array.isArray(input.modes)
      ? "当前记住的路线已不可用，请重新选择路线"
      : "路线能力还没读到，请稍后重试"
  }
  return ""
}

/** 补身份只依赖工程与链接；路线能力还没读到不影响这一步。 */
export function taskInputFailure(input: {
  projectRoot: string
  links: string[]
}): string {
  if (!input.projectRoot.trim()) return "先填工程目录"
  if (input.links.length === 0) return "至少填一个 MasterGo 链接（多条时一行一个）"
  return ""
}

export type OtherRouteRequest =
  | { ok: true; body: BoardAddBody }
  | { ok: false; failure: string }

const TASK_CREATION_FAILED = "任务创建未完成，请检查失败提示后重试"

function withFailure(result: CreateTasksResult): CreateTasksResult {
  if (result.ok || String(result.failure || "").trim()) return result
  return { ...result, failure: TASK_CREATION_FAILED }
}

/** A 与非 A 只有请求来源不同；建任务、暂存、回滚和逐条启动仍走同一个创建编排。 */
export async function createTasksForMode(input: {
  items: BoardItem[]
  projectRoot: string
  policy: BoardModePolicy
  automation: string
  images: Record<string, File>
  add: (body: BoardAddBody) => Promise<CreatedTasks>
  otherRequest: () => Promise<OtherRouteRequest>
  api?: TaskCreationApi
}): Promise<CreateTasksResult> {
  const links = input.items.map((item) => item.link)
  const allowUnclaimed = singlePageAllowsUnclaimedImage(input.items.length)
  const missingImage = pageImageFailure(input.policy.takesPageImage, links, input.images, allowUnclaimed)
  if (missingImage) return { ok: false, failure: missingImage, board: null }
  if (input.policy.runsPipelineAOnly) {
    return withFailure(await startPipelineA({
      items: input.items,
      projectRoot: input.projectRoot,
      automation: input.automation,
      takesPageImage: input.policy.takesPageImage,
      images: input.images,
      allowUnclaimed,
      add: input.add,
      api: input.api
    }))
  }

  const request = await input.otherRequest()
  if (!request.ok) {
    return {
      ok: false,
      failure: request.failure.trim() || TASK_CREATION_FAILED,
      board: null
    }
  }
  return withFailure(await createTasksWithPageImages({
    takesPageImage: input.policy.takesPageImage,
    images: input.images,
    allowUnclaimed,
    add: () => input.add(request.body),
    api: input.api
  }))
}
