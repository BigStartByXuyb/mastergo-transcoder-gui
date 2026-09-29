import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useIdentity } from "@/app/use-identity"

/*
 * useIdentity 的用例都走真的 api 层（只把 fetch 换掉）：
 * 要验证的正是「谁去取候选、取不到时给人什么话」这条路径，绕开 api 就测不到。
 * 候选列表与区域预览各有 600ms 防抖，所以这里等的是真实时间（waitFor 的 timeout 放宽）。
 */

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

function fail(message: string, hint = "") {
  return Promise.resolve(
    new Response(JSON.stringify({ error: { code: "BOOM", message, hint } }), { status: 400 })
  )
}

function stub(routes: { match: string; reply: () => Promise<Response> }[]) {
  vi.stubGlobal("fetch", (url: string) => {
    const hit = routes.find((route) => String(url).includes(route.match))
    if (!hit) return ok({ ok: true })
    return hit.reply()
  })
}

const NO_CANDIDATES = {
  ok: true,
  uiCandidates: [],
  candidates: [],
  ai: { used: false, items: [] },
  blocked: "这个工程还没有任何区域约定（登记表里没有页面，也没有带前缀的 Target）：写进 docs/page-registry.json"
}

function render(overrides: Partial<Parameters<typeof useIdentity>[0]> = {}) {
  const onFailure = vi.fn()
  const onPicked = vi.fn()
  const options = {
    link: "https://mastergo.com/goto/x?file=1&layer_id=2:3",
    projectRoot: "/project",
    target: "",
    ui: "",
    automation: "assist",
    onFailure,
    onPicked,
    ...overrides
  }
  const view = renderHook(() => useIdentity(options))
  return { ...view, onFailure, onPicked }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useIdentity", () => {
  it("工程目录带出登记表里的页面（界面按 UI 分组的数据源）", async () => {
    stub([
      {
        match: "/api/project/pages",
        reply: () =>
          ok({
            ok: true,
            pages: { exists: true, registryPath: "docs/page-registry.json", problem: "", pages: [{ target: "F1StopAdjust", ui: "F1", layerId: "357:208031" }] }
          })
      }
    ])
    const { result } = render()
    await waitFor(() => expect(result.current.pages?.pages.length).toBe(1), { timeout: 3000 })
    expect(result.current.pages?.pages[0].ui).toBe("F1")
  })

  it("工程目录为空时不请求登记表", async () => {
    const seen: string[] = []
    vi.stubGlobal("fetch", (url: string) => {
      seen.push(String(url))
      return ok({ ok: true })
    })
    const { result } = render({ projectRoot: "" })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700))
    })
    expect(result.current.pages).toBeNull()
    expect(seen.some((url) => url.includes("/api/project/pages"))).toBe(false)
  })

  it("手填了区域就以手填的为准，不再显示 Target 前缀的预览", async () => {
    stub([
      { match: "/api/identity/prefix", reply: () => ok({ ok: true, previewUi: "F1" }) }
    ])
    const { result } = render({ target: "F1StopAdjust", ui: "" })
    await waitFor(() => expect(result.current.derivedUi).toBe("F1"), { timeout: 3000 })

    const { result: filled } = render({ target: "F1StopAdjust", ui: "F3" })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700))
    })
    expect(filled.current.derivedUi).toBe("")
  })

  it("没有候选时把「项目第一次要人给区域」的原因交出去，不返回候选", async () => {
    stub([{ match: "/api/identity/candidates", reply: () => ok(NO_CANDIDATES) }])
    const { result, onFailure, onPicked } = render()
    await act(async () => {
      await result.current.fill()
    })
    expect(onFailure).toHaveBeenCalledWith(expect.stringContaining("还没有任何区域约定"))
    expect(onPicked).not.toHaveBeenCalled()
    expect(result.current.candidates).toEqual([])
  })

  it("自动层级下 fill 直接采用候选：写登记表并把结果回填出去", async () => {
    const candidate = { target: "F1StopAdjust", ui: "F1", semanticName: "StopAdjust", basis: "同文件先例", needsSemanticName: false }
    const applied: string[] = []
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/api/project/pages")) return ok({ ok: true, pages: { exists: true, registryPath: "", problem: "", pages: [] } })
      if (href.includes("/api/identity/candidates"))
        return ok({ ok: true, uiCandidates: [], candidates: [candidate], ai: { used: false, items: [] }, blocked: "" })
      if (href.includes("/api/identity/apply")) {
        applied.push(String(init?.body ?? ""))
        return ok({ ok: true, registryPath: "docs/page-registry.json", replaced: false })
      }
      return ok({ ok: true })
    })
    const { result, onPicked } = render({ automation: "auto" })
    await act(async () => {
      await result.current.fill()
    })
    expect(onPicked).toHaveBeenCalledWith("F1StopAdjust", "F1")
    expect(applied).toHaveLength(1)
    expect(applied[0]).toContain('"ui":"F1"')
  })

  it("辅助层级下 fill 只列候选，不自动写登记表", async () => {
    const candidate = { target: "F1StopAdjust", ui: "F1", semanticName: "StopAdjust", basis: "同文件先例", needsSemanticName: false }
    let applyCalls = 0
    vi.stubGlobal("fetch", (url: string) => {
      const href = String(url)
      if (href.includes("/api/identity/candidates"))
        return ok({ ok: true, uiCandidates: [], candidates: [candidate], ai: { used: false, items: [] }, blocked: "" })
      if (href.includes("/api/identity/apply")) applyCalls += 1
      return ok({ ok: true })
    })
    const { result, onPicked } = render({ automation: "assist" })
    await act(async () => {
      await result.current.fill()
    })
    expect(result.current.candidates).toHaveLength(1)
    expect(applyCalls).toBe(0)
    expect(onPicked).not.toHaveBeenCalled()
  })

  it("沿用登记过的页时，把候选里的设计页名一起写回，不抹掉登记", async () => {
    const applied: string[] = []
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/api/identity/apply")) {
        applied.push(String(init?.body ?? ""))
        return ok({ ok: true, registryPath: "docs/page-registry.json", replaced: true })
      }
      return ok({ ok: true, pages: { exists: true, registryPath: "", problem: "", pages: [] } })
    })
    const { result, onPicked } = render({ automation: "auto" })
    await act(async () => {
      await result.current.apply({
        target: "F4TargetTeaching",
        ui: "F4",
        semanticName: "",
        basis: "登记表里这一页已经登记过",
        needsSemanticName: false,
        registered: true,
        designPageName: "目标示教"
      })
    })
    expect(applied[0]).toContain('"designPageName":"目标示教"')
    expect(onPicked).toHaveBeenCalledWith("F4TargetTeaching", "F4")
  })

  it("取候选失败时把后端原因（含怎么修）写进 failure", async () => {
    stub([{ match: "/api/identity/candidates", reply: () => fail("缺少 MasterGo token", "请传 --token") }])
    const { result, onFailure } = render({ automation: "assist" })
    await act(async () => {
      await result.current.fill()
    })
    expect(onFailure).toHaveBeenCalledWith("缺少 MasterGo token：请传 --token")
  })

  it("从链接取设计页名填进输入框", async () => {
    stub([{ match: "/api/design/page-name", reply: () => ok({ ok: true, pageName: "停止调整", rootId: "124:077162" }) }])
    const { result } = render()
    await act(async () => {
      result.current.takeDesignPageName()
    })
    await waitFor(() => expect(result.current.name).toBe("停止调整"))
    expect(result.current.busy).toBe("")
  })
})
