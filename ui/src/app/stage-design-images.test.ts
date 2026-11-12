import { describe, expect, it, vi } from "vitest"

import {
  createTasksWithPageImages,
  pageImageFailure,
  ROLLED_BACK_NOTE,
  STAGE_FAILED_NOTE
} from "@/app/stage-design-images"
import type { Board } from "@/lib/api"

/*
 * 两个新建入口共用的编排：建任务 → 暂存 → 回滚 → 启动。
 * 这里用同形的假 API 驱动每条失败支路，确认页面两处不需要再各写一份收尾。
 */

const empty: Board = { workRoot: "", limits: { logical: 1, limit: 1 }, running: 0, tasks: [] }
const board = (running: number): Board => ({ ...empty, running })
type TaskCreationApi = NonNullable<Parameters<typeof createTasksWithPageImages>[0]["api"]>
const file = (content: string) =>
  ({ name: "picked.png", size: content.length, arrayBuffer: async () => new TextEncoder().encode(content).buffer }) as unknown as File

function fakeApi(overrides: Partial<TaskCreationApi> = {}): TaskCreationApi {
  return {
    stageDesignImage: vi.fn(async () => ({ ok: true as const })),
    boardStart: vi.fn(async () => ({ board: board(1) })),
    boardRemove: vi.fn(async () => ({ board: empty })),
    board: vi.fn(async () => ({ board: empty })),
    ...overrides
  }
}

describe("createTasksWithPageImages", () => {
  it("单页允许先选图、后填链接；多页不把待认领图复制给任意一行", () => {
    const picked = { "": file("a") }
    expect(pageImageFailure(true, ["https://a"], picked)).toBe("")
    expect(pageImageFailure(true, ["https://a", "https://b"], picked)).toContain("需要为每个页面选择")
  })

  it("单任务批次提交时使用待认领图", async () => {
    const api = fakeApi()
    const result = await createTasksWithPageImages({
      takesPageImage: true,
      images: { "": file("a") },
      add: async () => ({
        created: ["task-1"],
        board: { ...empty, tasks: [{ id: "task-1", request: { link: "https://a" } }] as Board["tasks"] }
      }),
      api
    })

    expect(api.stageDesignImage).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-1" }))
    expect(result.ok).toBe(true)
  })

  it("含 A 的路线先逐张暂存，再逐条显式启动", async () => {
    const api = fakeApi()
    const result = await createTasksWithPageImages({
      takesPageImage: true,
      images: { "https://a": file("a"), "https://b": file("b") },
      add: async () => ({
        created: ["task-1", "task-2"],
        board: {
          ...empty,
          tasks: [
            { id: "task-1", request: { link: "https://a" } },
            { id: "task-2", request: { link: "https://b" } }
          ] as Board["tasks"]
        }
      }),
      api
    })

    expect(vi.mocked(api.stageDesignImage).mock.calls.map(([body]) => body.taskId)).toEqual(["task-1", "task-2"])
    expect(vi.mocked(api.boardStart).mock.calls.map(([taskId]) => taskId)).toEqual(["task-1", "task-2"])
    expect(result).toMatchObject({ ok: true, created: ["task-1", "task-2"] })
  })

  it("B 不送图，但仍按同一编排显式启动", async () => {
    const api = fakeApi()
    const result = await createTasksWithPageImages({
      takesPageImage: false,
      images: { "https://a": file("a") },
      add: async () => ({ created: ["task-1"], board: empty }),
      api
    })

    expect(api.stageDesignImage).not.toHaveBeenCalled()
    expect(api.boardStart).toHaveBeenCalledWith("task-1")
    expect(result.ok).toBe(true)
  })

  it("暂存失败时整批撤销，不启动；失败原话带准确的后果", async () => {
    const api = fakeApi({
      stageDesignImage: vi.fn(async ({ taskId }) => {
        if (taskId === "task-1") throw new Error("这张图不是位图")
        return { ok: true as const }
      })
    })
    const result = await createTasksWithPageImages({
      takesPageImage: true,
      images: { "https://a": file("a"), "https://b": file("b") },
      add: async () => ({
        created: ["task-1", "task-2"],
        board: {
          ...empty,
          tasks: [
            { id: "task-1", request: { link: "https://a" } },
            { id: "task-2", request: { link: "https://b" } }
          ] as Board["tasks"]
        }
      }),
      api
    })

    expect(vi.mocked(api.boardRemove).mock.calls.map(([taskId]) => taskId)).toEqual(["task-1", "task-2"])
    expect(api.boardStart).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, failure: "这张图不是位图" + STAGE_FAILED_NOTE })
  })

  it("回滚失败也继续撤销其余任务，并回读服务端看板", async () => {
    const refreshed = board(0)
    const api = fakeApi({
      stageDesignImage: vi.fn(async () => { throw new Error("图坏了") }),
      boardRemove: vi.fn(async (taskId: string) => {
        if (taskId === "task-1") throw new Error("删除失败")
        return { board: refreshed }
      }),
      board: vi.fn(async () => ({ board: refreshed }))
    })
    const result = await createTasksWithPageImages({
      takesPageImage: true,
      images: { "https://a": file("a"), "https://b": file("b") },
      add: async () => ({
        created: ["task-1", "task-2"],
        board: {
          ...empty,
          tasks: [
            { id: "task-1", request: { link: "https://a" } },
            { id: "task-2", request: { link: "https://b" } }
          ] as Board["tasks"]
        }
      }),
      api
    })

    expect(vi.mocked(api.boardRemove).mock.calls.map(([taskId]) => taskId)).toEqual(["task-1", "task-2"])
    expect(api.board).toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, board: refreshed })
    expect(result.ok ? "" : result.failure).toContain("撤销刚建任务失败：删除失败")
  })

  it("身份写回失败时撤销已建任务与暂存件，不启动", async () => {
    const api = fakeApi()
    const result = await createTasksWithPageImages({
      takesPageImage: true,
      images: { "https://a": file("a"), "https://b": file("b") },
      beforeStart: async () => { throw new Error("登记表写入失败") },
      add: async () => ({
        created: ["task-1", "task-2"],
        board: {
          ...empty,
          tasks: [
            { id: "task-1", request: { link: "https://a" } },
            { id: "task-2", request: { link: "https://b" } }
          ] as Board["tasks"]
        }
      }),
      api
    })

    expect(api.stageDesignImage).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.boardRemove).mock.calls.map(([taskId]) => taskId)).toEqual(["task-1", "task-2"])
    expect(api.boardStart).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, failure: "登记表写入失败" + ROLLED_BACK_NOTE })
  })

  it("启动中途失败也尝试其余任务，再回读真实看板", async () => {
    const refreshed = board(1)
    const api = fakeApi({
      boardStart: vi.fn(async (taskId = "") => {
        if (taskId === "task-1") throw new Error("启动失败")
        return { board: refreshed }
      }),
      board: vi.fn(async () => ({ board: refreshed }))
    })
    const result = await createTasksWithPageImages({
      takesPageImage: false,
      images: {},
      add: async () => ({ created: ["task-1", "task-2"], board: empty }),
      api
    })

    expect(vi.mocked(api.boardStart).mock.calls.map(([taskId]) => taskId)).toEqual(["task-1", "task-2"])
    expect(api.board).toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, board: refreshed, created: ["task-1", "task-2"] })
    expect(result.ok ? "" : result.failure).toContain(
      "启动失败（本批任务仍保留在看板：task-1、task-2；已启动成功的会继续跑，未启动的需手动启动或移除）"
    )
  })
})
