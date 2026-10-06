import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { usePluginUpdate } from "@/app/use-plugin-update"
import { pluginUpdateFixture } from "@/lib/settings-fixtures"

// 自带那一份的两个动作与轮询：检查只调检查接口、装只调安装接口，装完那一下喊 onInstalled。

afterEach(() => {
  vi.unstubAllGlobals()
})

function stub(hooks: { onCheck?: () => void; onInstall?: () => void; fail?: boolean } = {}) {
  vi.stubGlobal("fetch", (_input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(_input)
    if (hooks.fail) return Promise.resolve(new Response(JSON.stringify({ error: { message: "连不上" } }), { status: 500 }))
    if (url.includes("/api/plugin/update/check")) {
      hooks.onCheck?.()
      return Promise.resolve(new Response(JSON.stringify({ ok: true, status: pluginUpdateFixture() }), { status: 200 }))
    }
    if (url.includes("/api/plugin/update/install")) {
      hooks.onInstall?.()
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            started: true,
            version: "1.0.371",
            note: "",
            status: pluginUpdateFixture()
          }),
          { status: 200 }
        )
      )
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, status: pluginUpdateFixture() }), { status: 200 }))
  })
}

describe("usePluginUpdate", () => {
  it("挂上就拉一次状态", async () => {
    stub()
    const { result } = renderHook(() => usePluginUpdate(() => {}))
    await waitFor(() => expect(result.current.update).not.toBeNull())
    expect(result.current.update?.local.version).toBe("1.0.369")
  })

  it("检查与装各打各的接口，装完那一下喊一声", async () => {
    const asked: string[] = []
    stub({ onCheck: () => asked.push("check"), onInstall: () => asked.push("install") })
    const { result } = renderHook(() => usePluginUpdate(() => asked.push("installed")))
    await waitFor(() => expect(result.current.update).not.toBeNull())

    await act(async () => {
      await result.current.check()
    })
    await act(async () => {
      await result.current.install()
    })
    expect(asked).toContain("check")
    expect(asked).toContain("install")
    expect(result.current.busy).toBe("")
  })

  it("读不到状态时落到 probe，不装作没事", async () => {
    stub({ fail: true })
    const { result } = renderHook(() => usePluginUpdate(() => {}))
    await waitFor(() => expect(result.current.probe).not.toBe(""))
  })

  it("检查与装失败：落到 failure，busy 复位", async () => {
    stub()
    const { result } = renderHook(() => usePluginUpdate(() => {}))
    await waitFor(() => expect(result.current.update).not.toBeNull())

    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ error: { message: "连不上" } }), { status: 500 })))
    await act(async () => {
      await result.current.check()
    })
    expect(result.current.failure).not.toBe("")

    await act(async () => {
      await result.current.install()
    })
    expect(result.current.busy).toBe("")
  })
})
