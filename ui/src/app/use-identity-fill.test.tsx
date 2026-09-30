import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useIdentityFill } from "@/app/use-identity-fill"
import type { BoardItem } from "@/lib/board-items"

/*
 * 与 use-identity 的用例同一种做法：走真的 api 层，只把 fetch 换掉。
 * 要验的是「自动层级会不会自己写、辅助层级停在哪、结果怎么回到文本」。
 */

const LINK = "https://mastergo.com/goto/x?file=1&layer_id=2:3"
const ROOT = "/project"

function item(patch: Partial<BoardItem> = {}): BoardItem {
  return { link: LINK, target: "", mode: "B", ...patch }
}

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

function stub(routes: { match: string; reply: () => Promise<Response> }[]) {
  vi.stubGlobal("fetch", (url: string) => {
    const hit = routes.find((route) => String(url).includes(route.match))
    if (!hit) return ok({ ok: true })
    return hit.reply()
  })
}

const CANDIDATE = {
  target: "F1StopAdjust",
  ui: "F1",
  semanticName: "StopAdjust",
  basis: "登记表里这一页已经登记过",
  needsSemanticName: false
}

const CANDIDATES_OK = {
  ok: true,
  uiCandidates: [],
  candidates: [CANDIDATE],
  ai: { used: false, items: [] },
  blocked: ""
}

function render(automation: string) {
  const onFilled = vi.fn()
  const onFailure = vi.fn()
  const view = renderHook(() => useIdentityFill({ automation, onFilled, onFailure }))
  return { ...view, onFilled, onFailure }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useIdentityFill", () => {
  it("自动化是「自动」时自己写进登记表并把 Target 交回去", async () => {
    stub([
      { match: "/api/design/page-name", reply: () => ok({ ok: true, pageName: "停止调整", rootId: "1" }) },
      { match: "/api/identity/candidates", reply: () => ok(CANDIDATES_OK) },
      { match: "/api/identity/apply", reply: () => ok({ ok: true, registryPath: "p", replaced: false }) }
    ])
    const view = render("auto")
    await act(async () => {
      await view.result.current.run([item()], ROOT, "F1")
    })
    expect(view.result.current.rows).toEqual([
      { kind: "filled", link: LINK, target: "F1StopAdjust", ui: "F1", basis: CANDIDATE.basis }
    ])
    expect([...view.onFilled.mock.calls[0][0]]).toEqual([[LINK, "F1StopAdjust"]])
  })

  it("自动化是「辅助」时只给候选，人点一条才写", async () => {
    stub([
      { match: "/api/design/page-name", reply: () => ok({ ok: true, pageName: "停止调整", rootId: "1" }) },
      { match: "/api/identity/candidates", reply: () => ok(CANDIDATES_OK) },
      { match: "/api/identity/apply", reply: () => ok({ ok: true, registryPath: "p", replaced: true }) }
    ])
    const view = render("assist")
    await act(async () => {
      await view.result.current.run([item()], ROOT, "")
    })
    const row = view.result.current.rows[0]
    expect(row.kind).toBe("pick")
    expect(view.onFilled).not.toHaveBeenCalled()

    await act(async () => {
      await view.result.current.take(row, CANDIDATE)
    })
    expect(view.result.current.rows[0]).toEqual({
      kind: "filled",
      link: LINK,
      target: "F1StopAdjust",
      ui: "F1",
      basis: "已写入工程登记表"
    })
    expect([...view.onFilled.mock.calls[0][0]]).toEqual([[LINK, "F1StopAdjust"]])
  })

  it("这一行自己写了 Target 就跳过，不去动它", async () => {
    stub([])
    const view = render("auto")
    await act(async () => {
      await view.result.current.run([item({ target: "F2Given" })], ROOT, "")
    })
    expect(view.result.current.rows[0]).toEqual({
      kind: "filled",
      link: LINK,
      target: "F2Given",
      ui: "",
      basis: "这一行自己写了 Target，没动"
    })
    expect(view.onFilled).not.toHaveBeenCalled()
  })

  it("后端挡住且没有可用候选时，把原因留在行上", async () => {
    stub([
      { match: "/api/design/page-name", reply: () => ok({ ok: true, pageName: "", rootId: "1" }) },
      {
        match: "/api/identity/candidates",
        reply: () =>
          ok({ ok: true, uiCandidates: [], candidates: [], ai: { used: false, items: [] }, blocked: "这个工程还没有区域约定" })
      }
    ])
    const view = render("auto")
    await act(async () => {
      await view.result.current.run([item()], ROOT, "")
    })
    expect(view.result.current.rows).toEqual([{ kind: "none", link: LINK, reason: "这个工程还没有区域约定" }])
  })

  it("取设计页名失败时把可读原因交给调用方，不留半截结论", async () => {
    stub([
      {
        match: "/api/design/page-name",
        reply: () =>
          Promise.resolve(
            new Response(JSON.stringify({ error: { code: "NO_TOKEN", message: "缺少 MasterGo token", hint: "" } }), { status: 400 })
          )
      }
    ])
    const view = render("auto")
    await act(async () => {
      await view.result.current.run([item()], ROOT, "")
    })
    await waitFor(() => expect(view.onFailure).toHaveBeenCalled())
    expect(view.result.current.rows).toEqual([])
  })
})
