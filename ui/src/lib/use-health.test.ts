import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useHealth } from "@/lib/use-health"

function health(version: string) {
  return { ok: true, version, plugin: {}, frames: [] }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useHealth", () => {
  it("拿到健康信息后把 offline 置回 false", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(health("1.0.0")), { status: 200 })))
    const { result } = renderHook(() => useHealth(60_000))
    await waitFor(() => expect(result.current.health?.version).toBe("1.0.0"))
    expect(result.current.offline).toBe(false)
  })

  it("请求失败时只标记不可用，不抛异常", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")))
    const { result } = renderHook(() => useHealth(60_000))
    await waitFor(() => expect(result.current.offline).toBe(true))
    expect(result.current.health).toBeNull()
    // 断在半路＝确认断连：只有这一种才敢说「服务没在跑」。
    expect(result.current.gone).toBe(true)
  })

  it("答了话却没答对（500）＝不能按「服务没在跑」说", async () => {
    vi.stubGlobal(
      "fetch",
      () => Promise.resolve(new Response(JSON.stringify({ code: "INTERNAL", message: "炸了", hint: "" }), { status: 500 }))
    )
    const { result } = renderHook(() => useHealth(60_000))
    await waitFor(() => expect(result.current.offline).toBe(true))
    expect(result.current.gone).toBe(false)
  })

  it("后端版本变了就刷新页面让前端跟上", async () => {
    let version = "1.0.0"
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(health(version)), { status: 200 })))
    const reload = vi.fn()
    vi.stubGlobal("location", { ...window.location, reload })

    const { result } = renderHook(() => useHealth(20))
    await waitFor(() => expect(result.current.health?.version).toBe("1.0.0"))
    version = "1.0.1"
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })
})
