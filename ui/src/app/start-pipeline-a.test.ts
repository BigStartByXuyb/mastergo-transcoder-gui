import { afterEach, describe, expect, it, vi } from "vitest"

import { startPipelineA } from "@/app/start-pipeline-a"
import type { Board } from "@/lib/api"

const LINK = "https://mastergo.com/goto/x?file=1&layer_id=2:3"
const empty: Board = { workRoot: "", limits: { logical: 1, limit: 1 }, running: 0, tasks: [] }
const file = { name: "picked.png", size: 1, arrayBuffer: async () => new Uint8Array([1]).buffer } as File

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

function mockIdentity(events: string[]) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/design/page-name")) {
      return Promise.resolve(json({ ok: true, pageName: "停止调整", rootId: "1:1" }))
    }
    if (url.includes("/api/identity/candidates")) {
      return Promise.resolve(json({
        ok: true,
        candidates: [{ target: "F3StopAdjust", ui: "F3", basis: "", needsSemanticName: false }],
        ai: { used: false, items: [] },
        blocked: ""
      }))
    }
    if (url.includes("/api/identity/apply")) {
      events.push("apply")
      return Promise.resolve(json({ ok: true, replaced: false }))
    }
    throw new Error("unexpected " + url)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("startPipelineA", () => {
  it("按同一顺序完成身份准备、建任务、身份写回与启动", async () => {
    const events: string[] = []
    mockIdentity(events)

    const api = {
      stageDesignImage: vi.fn(async () => {
        events.push("stage")
        return { ok: true as const }
      }),
      boardRemove: vi.fn(),
      board: vi.fn(),
      boardStart: vi.fn(async () => {
        events.push("start")
        return { board: { ...empty, running: 1 } }
      })
    }
    const result = await startPipelineA({
      items: [{ link: LINK, target: "", mode: "A" }],
      projectRoot: "project",
      automation: "auto",
      takesPageImage: true,
      images: { [LINK]: file },
      allowUnclaimed: true,
      add: async (body) => {
        events.push("add")
        expect(body).toMatchObject({
          ui: "",
          autoMerge: true,
          overwrite: true,
          stopAfter: "",
          items: [{ link: LINK, target: "F3StopAdjust", ui: "F3", mode: "A" }]
        })
        return { created: ["task-1"], board: { ...empty, tasks: [{ id: "task-1", request: { link: LINK } }] as Board["tasks"] } }
      },
      api
    })

    expect(events).toEqual(["add", "stage", "apply", "start"])
    expect(result).toMatchObject({ ok: true, created: ["task-1"] })
  })

  it("是否暂存页面 PNG 只读调用方传入的路线能力", async () => {
    mockIdentity([])
    const api = {
      stageDesignImage: vi.fn(),
      boardRemove: vi.fn(),
      board: vi.fn(),
      boardStart: vi.fn(async () => ({ board: { ...empty, running: 1 } }))
    }
    const result = await startPipelineA({
      items: [{ link: LINK, target: "", mode: "A" }],
      projectRoot: "project",
      automation: "off",
      takesPageImage: false,
      images: { [LINK]: file },
      allowUnclaimed: true,
      add: async () => ({
        created: ["task-1"],
        board: { ...empty, tasks: [{ id: "task-1", request: { link: LINK } }] as Board["tasks"] }
      }),
      api
    })

    expect(api.stageDesignImage).not.toHaveBeenCalled()
    expect(api.boardStart).toHaveBeenCalledWith("task-1")
    expect(result.ok).toBe(true)
  })
})
