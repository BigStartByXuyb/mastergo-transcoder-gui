import type { BoardAddBody } from "@/lib/api"
import type { BoardItem } from "@/lib/board-items"
import { preparePipelineAItems } from "@/app/prepare-pipeline-items"
import {
  createTasksWithPageImages,
  type CreateTasksResult,
  type CreatedTasks,
  type TaskCreationApi
} from "@/app/stage-design-images"
import { applyIdentities } from "@/lib/identity-flow"

/** A 路线唯一的启动编排：身份只读准备 → 完整请求 → 建任务/暂存/身份写回/显式启动。 */
export async function startPipelineA(input: {
  items: BoardItem[]
  projectRoot: string
  automation: string
  takesPageImage: boolean
  images: Record<string, File>
  allowUnclaimed: boolean
  add: (body: BoardAddBody) => Promise<CreatedTasks>
  api?: TaskCreationApi
}): Promise<CreateTasksResult> {
  const prepared = await preparePipelineAItems(input.items, input.projectRoot, { automation: input.automation })
  if (!prepared.ok) return { ok: false, failure: prepared.reason, board: null }

  const body: BoardAddBody = {
    projectRoot: input.projectRoot,
    ...prepared.defaults,
    deferStart: true,
    items: prepared.items
  }
  return await createTasksWithPageImages({
    takesPageImage: input.takesPageImage,
    images: input.images,
    allowUnclaimed: input.allowUnclaimed,
    beforeStart: async () => {
      await applyIdentities(prepared.identities)
    },
    add: () => input.add(body),
    api: input.api
  })
}
