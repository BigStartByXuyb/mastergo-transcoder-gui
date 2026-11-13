import { afterEach, describe, expect, it, vi } from "vitest"

import { createTasksForMode, taskEntryFailure, taskInputFailure } from "@/app/task-creation-entry"
import type { Board, BoardAddBody, BoardModePolicy } from "@/lib/api"

const policy: BoardModePolicy = {
  mode: "B",
  routes: ["B"],
  takesPageImage: false,
  runsPipelineAOnly: false
}

const emptyBoard: Board = {
  workRoot: "project",
  limits: { logical: 0, limit: 1 },
  running: 0,
  tasks: []
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("taskEntryFailure", () => {
  it("两个入口用同一套顺序判断工程、链接与路线能力", () => {
    expect(taskEntryFailure({ projectRoot: "", links: [], modes: undefined, policy: null })).toBe("先填工程目录")
    expect(taskEntryFailure({ projectRoot: "p", links: [], modes: undefined, policy: null }))
      .toBe("至少填一个 MasterGo 链接（多条时一行一个）")
    expect(taskEntryFailure({ projectRoot: "p", links: ["https://a"], modes: [policy], policy: null }))
      .toBe("当前记住的路线已不可用，请重新选择路线")
    expect(taskEntryFailure({ projectRoot: "p", links: ["https://a"], modes: undefined, policy: null }))
      .toBe("路线能力还没读到，请稍后重试")
    expect(taskEntryFailure({ projectRoot: "p", links: ["https://a"], modes: [policy], policy })).toBe("")
  })
})

describe("taskInputFailure", () => {
  it("补身份不依赖路线能力，只校验工程与链接", () => {
    expect(taskInputFailure({ projectRoot: "", links: [] })).toBe("先填工程目录")
    expect(taskInputFailure({ projectRoot: "p", links: [] })).toBe("至少填一个 MasterGo 链接（多条时一行一个）")
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
      automation: "assist",
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
      automation: "assist",
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

  it("非 A 请求准备失败时，空原因也收口成可显示的失败文案", async () => {
    const add = vi.fn()
    const result = await createTasksForMode({
      items: [{ link: "https://mastergo.com/goto/a?file=1&layer_id=2:3", target: "", mode: "B" }],
      projectRoot: "project",
      policy,
      automation: "assist",
      images: {},
      add,
      otherRequest: async () => ({ ok: false, failure: "" })
    })

    expect(result).toEqual({
      ok: false,
      failure: expect.stringMatching(/任务创建未完成/),
      board: null
    })
    expect(add).not.toHaveBeenCalled()
  })

  it("非 A 的手写 Target 与链接登记页冲突时在创建前拒绝", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/design/page-name")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, pageName: "停止调整", rootId: "1:1" }), { status: 200 }))
      }
      if (url.includes("/api/identity/candidates")) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          candidates: [{
            target: "F4Registered",
            ui: "F4",
            basis: "登记表",
            needsSemanticName: false,
            registered: true
          }],
          ai: { used: false, items: [] },
          blocked: ""
        }), { status: 200 }))
      }
      throw new Error("unexpected " + url)
    })
    const add = vi.fn()
    const otherRequest = vi.fn()
    const result = await createTasksForMode({
      items: [{ link: "https://mastergo.com/goto/a?file=1&layer_id=2:3", target: "F3Wrong", mode: "B" }],
      projectRoot: "project",
      policy,
      automation: "assist",
      images: {},
      add,
      otherRequest
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure).toContain("F4Registered")
    expect(otherRequest).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it("非 A 的手写 Target 对账通过后原值交给请求准备并用于创建", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/design/page-name")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, pageName: "停止调整", rootId: "1:1" }), { status: 200 }))
      }
      if (url.includes("/api/identity/candidates")) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          candidates: [{
            target: "F4Registered",
            ui: "F4",
            basis: "登记表",
            needsSemanticName: false,
            registered: true
          }],
          ai: { used: false, items: [] },
          blocked: ""
        }), { status: 200 }))
      }
      if (url.includes("/api/identity/prefix")) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          previewUi: "F4",
          semanticName: "Registered",
          complete: true
        }), { status: 200 }))
      }
      throw new Error("unexpected " + url + " " + String(init?.method ?? "GET"))
    })
    const body: BoardAddBody = {
      projectRoot: "project",
      ui: "",
      autoMerge: true,
      overwrite: true,
      stopAfter: "",
      items: [{ link: "https://mastergo.com/goto/a?file=1&layer_id=2:3", target: "F4Registered", mode: "B", ui: "F4" }]
    }
    const otherRequest = vi.fn(async () => ({ ok: true as const, body }))
    const add = vi.fn(async () => ({
      board: emptyBoard,
      created: ["task-1"]
    }))
    const result = await createTasksForMode({
      items: [{ link: "https://mastergo.com/goto/a?file=1&layer_id=2:3", target: "F4Registered", mode: "B" }],
      projectRoot: "project",
      policy,
      automation: "assist",
      images: {},
      add,
      otherRequest,
      api: {
        stageDesignImage: vi.fn(),
        boardStart: vi.fn(async () => ({ board: emptyBoard })),
        boardRemove: vi.fn(),
        board: vi.fn()
      }
    })

    expect(otherRequest).toHaveBeenCalledWith([
      expect.objectContaining({ target: "F4Registered", ui: "F4", mode: "B" })
    ])
    expect(add).toHaveBeenCalledWith(body)
    expect(result.ok).toBe(true)
  })
})
