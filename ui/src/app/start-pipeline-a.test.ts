import { afterEach, describe, expect, it, vi } from "vitest"

import { startPipelineA } from "@/app/start-pipeline-a"
import type { Board } from "@/lib/api"

const LINK = "https://mastergo.com/goto/x?file=1&layer_id=2:3"
const empty: Board = { workRoot: "", limits: { logical: 1, limit: 1 }, running: 0, tasks: [] }

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("startPipelineA", () => {
  it("缺页面 PNG 时在身份准备之前就返回", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const add = vi.fn()

    const result = await startPipelineA({
      items: [{ link: LINK, target: "", mode: "A" }],
      projectRoot: "project",
      useAi: true,
      takesPageImage: true,
      images: {},
      add
    })

    expect(result).toEqual({ ok: false, failure: "含 A 的路线需要为每个页面选择页面 PNG", board: null })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it("按同一顺序完成身份准备、建任务、身份写回与启动", async () => {
    const events: string[] = []
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

    const api = {
      stageDesignImage: vi.fn(),
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
      useAi: true,
      takesPageImage: false,
      images: {},
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

    expect(events).toEqual(["add", "apply", "start"])
    expect(result).toMatchObject({ ok: true, created: ["task-1"] })
  })
})
