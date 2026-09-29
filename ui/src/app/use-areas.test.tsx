import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useAreas } from "@/app/use-areas"
import { readRecentProjects } from "@/lib/recent-projects"

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

function boardTask(overrides: Record<string, unknown>) {
  return {
    id: "t1",
    state: "merged",
    stateLabel: "已合并",
    request: { projectRoot: "/project", ui: "F1", target: "F1StopAdjust", mode: "A" },
    steps: [],
    ...overrides
  }
}

function stub(routes: { match: string; reply: () => Promise<Response> }[]) {
  vi.stubGlobal("fetch", (url: string) => {
    const hit = routes.find((route) => String(url).includes(route.match))
    return hit ? hit.reply() : ok({ ok: true })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe("useAreas", () => {
  it("看板任务与工程登记表合起来出「工程 → 区域」，并把工程记进最近列表", async () => {
    stub([
      { match: "/api/board", reply: () => ok({ ok: true, board: { tasks: [boardTask({})] } }) },
      {
        match: "/api/project/pages",
        reply: () =>
          ok({
            ok: true,
            pages: {
              exists: true,
              registryPath: "",
              problem: "",
              pages: [
                { target: "F1StopAdjust", ui: "F1", layerId: "1:2", designPageName: "停止调整" },
                { target: "F2Align", ui: "F2", layerId: "1:3", designPageName: "对位" }
              ]
            }
          })
      }
    ])
    const { result } = renderHook(() => useAreas())
    await waitFor(() => expect(result.current.areas.length).toBe(2), { timeout: 3000 })
    expect(result.current.loaded).toBe(true)
    expect(result.current.areas.map((area) => area.ui)).toEqual(["F1", "F2"])
    expect(result.current.areas[0].tasks.map((task) => task.id)).toEqual(["t1"])
    expect(result.current.areas[1].pages.map((page) => page.target)).toEqual(["F2Align"])
    expect(readRecentProjects()).toEqual(["/project"])
  })

  it("没有任务也没有登记表时，区域列表是空的", async () => {
    stub([
      { match: "/api/board", reply: () => ok({ ok: true, board: { tasks: [] } }) },
      { match: "/api/project/pages", reply: () => ok({ ok: true, pages: { exists: false, registryPath: "", problem: "", pages: [] } }) }
    ])
    const { result } = renderHook(() => useAreas())
    await waitFor(() => expect(result.current.projects).toEqual([]))
    expect(result.current.areas).toEqual([])
  })

  it("登记表读不出来时不影响任务：区域照样按任务列出来", async () => {
    stub([
      { match: "/api/board", reply: () => ok({ ok: true, board: { tasks: [boardTask({ request: { projectRoot: "/p2", ui: "HH" } })] } }) },
      { match: "/api/project/pages", reply: () => Promise.reject(new Error("ENOENT")) }
    ])
    const { result } = renderHook(() => useAreas())
    await waitFor(() => expect(result.current.areas.length).toBe(1), { timeout: 3000 })
    expect(result.current.areas[0].ui).toBe("HH")
    expect(result.current.areas[0].pages).toEqual([])
  })
})
