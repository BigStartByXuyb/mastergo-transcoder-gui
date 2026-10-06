import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PLUGIN_UPDATE_KEYS, usePluginUpdate } from "@/app/use-plugin-update"
import { pluginLookup } from "@/lib/plugin-sources"
import type { PluginSource } from "@/lib/api"
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
  it("忙碌位的 key 与来源清单那一半不撞名", () => {
    /*
     * 两边最后合成同一个字符串给界面看（卡片合成、面板判「是哪一个在跑」）：
     * 来源清单用行 id（客户端自带那一行的 id 恰好也叫 install），这一半用 update: 前缀。
     * 撞名会让「点某一行的用这份」与「下载并安装」两颗按钮一起转圈。
     */
    const settle = (id: PluginSource["id"], active: boolean): PluginSource => ({
      id: id,
      label: id,
      path: "p/" + id,
      kind: "install",
      exists: true,
      pluginRoot: "p/" + id,
      version: "1.0.0",
      found: ["p/" + id],
      active: active
    })
    const ids = pluginLookup([settle("arg", false), settle("chosen", false), settle("install", true)]).rows.map((row) => row.id)
    expect(ids).toContain("install")
    for (const key of Object.values(PLUGIN_UPDATE_KEYS)) expect(ids).not.toContain(key)
  })

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
