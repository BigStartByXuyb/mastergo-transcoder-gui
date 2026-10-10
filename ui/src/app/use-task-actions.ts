import { useState } from "react"
import { toast } from "sonner"

import { ApiFailure, api, type Board, type BoardTask, type Job, type PipelineStep, type PluginSummary } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 一条任务上能做的动作：开始（建任务并启动）/ 停 / 从断点继续 / 合并 / 冲突裁决 / 重读契约。
 *
 * 每个动作都只做三件事：调后端、把后端回的最新看板（与运行 / 契约）换到界面上、把失败原话交出去。
 * 六条动作全走同一个 run 骨架 —— 失败只有一个出口（页面的 failure），不再一半走横幅、一半只在 toast 里闪一下。
 */

export function useTaskActions(input: {
  /** 后端每个动作都回最新的看板：直接换掉页面上那一份，别再多取一次。 */
  onBoard: (board: Board) => void
  onPlugin: (plugin: PluginSummary, contract: PipelineStep[]) => void
  onJob: (job: Job) => void
  /** 续跑之前把界面上那次运行的日志收干净（换了一条运行，日志要从头读）。 */
  onJobReset: () => void
  onFailure: (message: string) => void
  /** 这一行已经不在看板上（被清掉）：把看板拉回最新。 */
  onTaskGone: () => void
}) {
  const [busy, setBusy] = useState("")

  async function run<T>(label: string, body: () => Promise<T>, onDone: (value: T) => void): Promise<T> {
    input.onFailure("")
    setBusy(label)
    try {
      const value = await body()
      onDone(value)
      return value
    } catch (error) {
      input.onFailure(describeFailure(error))
      throw error
    } finally {
      setBusy("")
    }
  }

  return {
    busy,

    /** 开始 = 新建看板任务 + 启动它；身份补全在调用方先做完（它要知道回填了什么）。 */
    start: async (body: Parameters<typeof api.boardAdd>[0]) => {
      return await run("start", () => api.boardAdd(body), (added) => input.onBoard(added.board))
    },

    startJob: async (taskId: string) => {
      await run("start", () => api.boardStart(taskId), (payload) => input.onBoard(payload.board))
    },

    stop: async (task: BoardTask) => {
      await run("stop", () => api.boardStop(task.id), (payload) => input.onBoard(payload.board)).catch(() => undefined)
    },

    resume: async (task: BoardTask) => {
      try {
        const payload = await run("resume", () => api.runResume(task.id), (value) => {
          input.onJobReset()
          input.onJob(value.job)
        })
        toast.success(
          "已继续：路线 " +
            payload.mode +
            (payload.resumedFrom === "起点" ? "（从起点）" : "（从 " + payload.resumedFrom + "）") +
            (payload.recomputedManifest ? "；已有页面 → 回到生成 Bundle 清单的那一步重算" : "") +
            (payload.reconciled && (payload.reconciled.removed > 0 || payload.reconciled.renamed > 0)
              ? "；命名表已修回台账口径：" +
                [
                  payload.reconciled.removed > 0 ? "裁掉 " + payload.reconciled.removed + " 条当前不登记的下标" : "",
                  payload.reconciled.renamed > 0 ? "改掉 " + payload.reconciled.renamed + " 条重名资源名" : ""
                ]
                  .filter(Boolean)
                  .join("、")
              : "")
        )
      } catch (error) {
        // 这一行已经不在看板上（被清掉、或换了工程）：把看板拉回最新，别对着不存在的任务点。
        if (error instanceof ApiFailure && error.code === "NO_TASK") input.onTaskGone()
      }
    },

    merge: async (task: BoardTask) => {
      await run("merge", () => api.boardMerge(task.id), (payload) => input.onBoard(payload.board)).catch(() => undefined)
    },

    resolveConflict: async (task: BoardTask, path: string, pick: "mine" | "main" | "clear") => {
      await run("resolve:" + path, () => api.boardResolve(task.id, path, pick), (payload) => input.onBoard(payload.board)).catch(
        () => undefined
      )
    },

    reloadContract: async () => {
      const payload = await run("contract", () => api.plugin(), (value) => input.onPlugin(value.plugin, value.steps)).catch(
        () => null
      )
      if (payload) toast.success("已重新读取流水线契约")
    }
  }
}
