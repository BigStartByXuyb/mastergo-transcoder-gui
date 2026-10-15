import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useSettings } from "@/lib/use-settings"

function body(mastergoHasToken: boolean) {
  return {
    ok: true,
    settings: {
      providers: [],
      ai: { provider: "", baseUrl: "", model: "", hasKey: false },
      automation: "assist",
      agent: { allowWrite: false },
      mastergo: { hasToken: mastergoHasToken, source: "", sourceLabel: "" }
    }
  }
}

function ok(payload: unknown) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useSettings", () => {
  it("读到设置后放进 state，failure 清空", async () => {
    vi.stubGlobal("fetch", () => ok(body(false)))
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())
    expect(result.current.failure).toBe("")
  })

  it("读失败只说一句可读的话，不抛异常、不留半份 state", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")))
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.failure).not.toBe(""))
    expect(result.current.settings).toBeNull()
  })

  it("保存后立刻用后端返回的那份更新 state", async () => {
    vi.stubGlobal("fetch", () => ok(body(false)))
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    vi.stubGlobal("fetch", () => ok(body(true)))
    await act(async () => {
      await result.current.save({ mastergo: { token: "mg_x" } })
    })
    expect(result.current.settings?.mastergo.hasToken).toBe(true)
  })
})
