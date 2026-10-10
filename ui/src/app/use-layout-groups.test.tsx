import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useLayoutGroups } from "@/app/use-layout-groups"
import { drive } from "@/lib/settings-fixtures"

/*
 * 布局确认取数：任务每推进就刷新一次，刷新不能把人已经拖好的分组盖回服务端那一份
 * （面板的指引就是「先改好、等停点再确认」）；保存成功之后表就是服务端那一份，再刷新就该按服务端的来。
 */

const WORK_DIR = drive("D", "work", "task-1")
const SERVER_GROUPS = [{ id: "RightTools", kind: "column" as const, members: ["1:9", "1:10"] }]

function stub(hooks: { onConfirm?: (body: unknown) => void } = {}) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("/api/confirm")) {
      hooks.onConfirm?.(JSON.parse(String(init?.body)))
      return Promise.resolve(new Response(JSON.stringify({ ok: true, written: [], job: null }), { status: 200 }))
    }
    if (url.includes("/api/settings")) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, settings: { layoutAutoPass: false } }), { status: 200 }))
    }
    if (url.includes("/api/ai/suggest")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, groups: [{ id: "FromAi", kind: "row", members: ["1:9", "1:10"] }] }), { status: 200 })
      )
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          layout: {
            available: true,
            reason: "",
            controls: [
              { ref: "1:9", controlType: "IconButton", text: "确定", absX: 0, absY: 0, w: 10, h: 10 },
              { ref: "1:10", controlType: "IconButton", text: "取消", absX: 40, absY: 0, w: 10, h: 10 }
            ],
            groups: SERVER_GROUPS,
            hasGroups: true,
            canSuggest: true
          }
        }),
        { status: 200 }
      )
    )
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const LOCAL_GROUPS = [{ id: "Mine", kind: "row" as const, members: ["1:9", "1:10"] }]

describe("useLayoutGroups", () => {
  it("读过一次就有了控件清单与分组", async () => {
    stub()
    const { result } = renderHook(() => useLayoutGroups({ taskId: "t", runId: "j", resume: true, projectRoot: WORK_DIR, target: "DemoPage", updatedAt: "" }))
    await waitFor(() => expect(result.current.groups.length).toBe(1))
    expect(result.current.controls.length).toBe(2)
  })

  it("任务推进触发的刷新不覆盖人改过的分组；保存之后回到服务端那一份", async () => {
    let confirmed: { groups?: unknown } = {}
    stub({ onConfirm: (body) => (confirmed = body as { groups: unknown }) })
    const { result, rerender } = renderHook(
      (props: { updatedAt: string }) =>
        useLayoutGroups({ taskId: "t", runId: "j", resume: true, projectRoot: WORK_DIR, target: "DemoPage", updatedAt: props.updatedAt }),
      { initialProps: { updatedAt: "1" } }
    )
    await waitFor(() => expect(result.current.groups.length).toBe(1))

    act(() => result.current.setGroups(LOCAL_GROUPS))
    expect(result.current.groups[0].id).toBe("Mine")

    // 任务跑完一步 → updatedAt 变 → 重新读一次：本地改动还在。
    rerender({ updatedAt: "2" })
    await waitFor(() => expect(result.current.controls.length).toBe(2))
    expect(result.current.groups[0].id).toBe("Mine")

    // 保存成功（写的就是本地那份）→ 再刷新就按服务端的来，本地不再是「改过没保存」。
    await act(async () => {
      await result.current.save()
    })
    expect(confirmed.groups).toEqual(LOCAL_GROUPS)
    rerender({ updatedAt: "3" })
    await waitFor(() => expect(result.current.groups[0].id).toBe("RightTools"))
  })

  it("AI 出的候选也算「改过」：任务推进时同样不被覆盖", async () => {
    stub()
    const { result, rerender } = renderHook(
      (props: { updatedAt: string }) =>
        useLayoutGroups({ taskId: "t", runId: "j", resume: true, projectRoot: WORK_DIR, target: "DemoPage", updatedAt: props.updatedAt }),
      { initialProps: { updatedAt: "1" } }
    )
    await waitFor(() => expect(result.current.groups.length).toBe(1))

    await act(async () => {
      await result.current.suggest()
    })
    expect(result.current.groups[0].id).toBe("FromAi")

    rerender({ updatedAt: "2" })
    await waitFor(() => expect(result.current.controls.length).toBe(2))
    expect(result.current.groups[0].id).toBe("FromAi")
  })

  it("刷新成功会把上一次读盘留下的错收掉", async () => {
    let fail = true
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      if (String(input).includes("/api/settings")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, settings: { layoutAutoPass: false } }), { status: 200 }))
      }
      if (fail) return Promise.reject(new Error("ECONNREFUSED"))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            layout: { available: true, reason: "", controls: [], groups: SERVER_GROUPS, hasGroups: true, canSuggest: false }
          }),
          { status: 200 }
        )
      )
    })
    const { result, rerender } = renderHook(
      (props: { updatedAt: string }) =>
        useLayoutGroups({ taskId: "t", runId: "j", resume: true, projectRoot: WORK_DIR, target: "DemoPage", updatedAt: props.updatedAt }),
      { initialProps: { updatedAt: "1" } }
    )
    await waitFor(() => expect(result.current.failure).not.toBe(""))

    fail = false
    rerender({ updatedAt: "2" })
    // 等这一次读真的落地（failure 是在读之前清的，单独等它会抢在请求前面通过）。
    await waitFor(() => expect(result.current.groups.length).toBe(1))
    expect(result.current.failure).toBe("")
  })
})
