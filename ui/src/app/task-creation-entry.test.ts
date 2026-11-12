import { describe, expect, it, vi } from "vitest"

import { createTasksForMode, taskEntryFailure, taskInputFailure } from "@/app/task-creation-entry"
import type { Board, BoardAddBody, BoardModePolicy } from "@/lib/api"

const empty: Board = { workRoot: "", limits: { logical: 1, limit: 1 }, running: 0, tasks: [] }
const policy: BoardModePolicy = {
  mode: "B",
  routes: ["B"],
  takesPageImage: false,
  runsPipelineAOnly: false
}

describe("taskEntryFailure", () => {
  it("两个入口用同一套顺序判断工程、链接与路线能力", () => {
    expect(taskEntryFailure({ projectRoot: "", links: [], board: empty, policy: null })).toBe("先填工程目录")
    expect(taskEntryFailure({ projectRoot: "p", links: [], board: empty, policy: null }))
      .toBe("一行一个 MasterGo 链接，至少一行")
    expect(taskEntryFailure({ projectRoot: "p", links: ["https://a"], board: empty, policy: null }))
      .toBe("当前记住的路线已不可用，请重新选择路线")
    expect(taskEntryFailure({ projectRoot: "p", links: ["https://a"], board: null, policy: null }))
      .toBe("路线能力还没读到，请稍后重试")
    expect(taskEntryFailure({ projectRoot: "p", links: ["https://a"], board: empty, policy })).toBe("")
  })
})

describe("taskInputFailure", () => {
  it("补身份不依赖路线能力，只校验工程与链接", () => {
    expect(taskInputFailure({ projectRoot: "", links: [] })).toBe("先填工程目录")
    expect(taskInputFailure({ projectRoot: "p", links: [] })).toBe("一行一个 MasterGo 链接，至少一行")
    expect(taskInputFailure({ projectRoot: "p", links: ["https://a"] })).toBe("")
  })
})

describe("createTasksForMode", () => {
  it("A 缺页面 PNG 时在身份准备前拒绝，不建任务也不启动", async () => {
    const otherRequest = vi.fn()
    const add = vi.fn()
    const api = {
      stageDesignImage: vi.fn(),
      boardRemove: vi.fn(),
      board: vi.fn(),
      boardStart: vi.fn()
    }
    const result = await createTasksForMode({
      items: [{ link: "https://mastergo.com/goto/a?file=1&layer_id=2:3", target: "", mode: "A" }],
      projectRoot: "project",
      policy: {
        mode: "A",
        routes: ["A"],
        takesPageImage: true,
        runsPipelineAOnly: true
      },
      useAi: true,
      images: {},
      add,
      otherRequest,
      api
    })

    expect(result).toEqual({
      ok: false,
      failure: "含 A 的路线需要为每个页面选择页面 PNG",
      board: null
    })
    expect(otherRequest).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
    expect(api.stageDesignImage).not.toHaveBeenCalled()
    expect(api.boardStart).not.toHaveBeenCalled()
  })

  it("AB 缺页面 PNG 时先拒绝，不准备请求，也不建任务", async () => {
    const body: BoardAddBody = {
      projectRoot: "project",
      ui: "",
      autoMerge: true,
      overwrite: true,
      stopAfter: "",
      items: []
    }
    const otherRequest = vi.fn(async () => ({
      ok: true as const,
      body
    }))
    const add = vi.fn()
    const result = await createTasksForMode({
      items: [{ link: "https://mastergo.com/goto/a?file=1&layer_id=2:3", target: "", mode: "AB" }],
      projectRoot: "project",
      policy: {
        mode: "AB",
        routes: ["A", "B"],
        takesPageImage: true,
        runsPipelineAOnly: false
      },
      useAi: true,
      images: {},
      add,
      otherRequest
    })

    expect(result).toEqual({
      ok: false,
      failure: "含 A 的路线需要为每个页面选择页面 PNG",
      board: null
    })
    expect(otherRequest).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })
})
