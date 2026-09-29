import { act, renderHook, waitFor } from "@testing-library/react"
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

    // 侧边栏工程行上的「移除」：只清本地记忆（界面只在它没有任务时才给这个入口）。
    act(() => result.current.forget("/project"))
    expect(result.current.projects).toEqual([])
    expect(readRecentProjects()).toEqual([])
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

  it("任务账变了就重新拉登记表：新建任务写进登记表的区域这一会话里能看到", async () => {
    let pages = [{ target: "F1StopAdjust", ui: "F1", layerId: "1:2", designPageName: "停止调整" }]
    let tasks = [boardTask({})]
    vi.stubGlobal("fetch", (url: string) => {
      const href = String(url)
      if (href.includes("/api/board")) return ok({ ok: true, board: { tasks: tasks } })
      if (href.includes("/api/project/pages")) {
        return ok({ ok: true, pages: { exists: true, registryPath: "", problem: "", pages: pages } })
      }
      return ok({ ok: true })
    })

    const { result } = renderHook(() => useAreas())
    await waitFor(() => expect(result.current.areas.map((area) => area.ui)).toEqual(["F1"]), { timeout: 3000 })

    // 跑完一轮之后登记表多了一页、任务账也变了（新任务进来）→ 缓存作废并重拉。
    pages = pages.concat([{ target: "F2Align", ui: "F2", layerId: "1:3", designPageName: "对位" }])
    tasks = tasks.concat([boardTask({ id: "t2", request: { projectRoot: "/project", ui: "F2", target: "F2Align", mode: "A" } })])
    await waitFor(() => expect(result.current.areas.map((area) => area.ui)).toEqual(["F1", "F2"]), { timeout: 4000 })
  })
})
