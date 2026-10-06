import { act, renderHook, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, describe, expect, it, vi } from "vitest"

import { usePluginSources } from "@/app/use-plugin-sources"
import type { PluginSources } from "@/lib/api"
import { drive } from "@/lib/settings-fixtures"

// 来源清单这一半：读一次；换一份（含「交给客户端找」）；选目录（选到就换过去、取消就说一句）。

// 夹具路径按段拼：源码里不出现「盘符 + 反斜杠」那种机器专属写法（结构检查会拦）。
const MINE = drive("D", "mine", "mastergo-wpf-transcoder")
const PICKED = drive("D", "picked", "mastergo-wpf-transcoder")

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const VIEW: PluginSources = {
  ok: true,
  plugin: { root: "", version: "", engine: "", engineExists: false, runAllExists: false, failure: "" },
  chosen: "",
  sources: []
}

function stub(hooks: { onChoose?: (body: unknown) => void; onPick?: () => void; picks?: { path: string; reason: string } } = {}) {
  vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(_input)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (url.includes("/api/system/pick-folder")) {
      hooks.onPick?.()
      return Promise.resolve(new Response(JSON.stringify(hooks.picks ?? { path: "", reason: "取消了" }), { status: 200 }))
    }
    if (url.includes("/api/plugin/choose")) {
      hooks.onChoose?.(body)
      return Promise.resolve(new Response(JSON.stringify(VIEW), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(VIEW), { status: 200 }))
  })
}

describe("usePluginSources", () => {
  it("挂上就读一次来源清单", async () => {
    stub()
    const { result } = renderHook(() => usePluginSources())
    await waitFor(() => expect(result.current.view).not.toBeNull())
    expect(result.current.busy).toBe("")
  })

  it("换一份：把解析到的插件根交给后端，换完提示一句", async () => {
    const asked: unknown[] = []
    const success = vi.spyOn(toast, "success")
    stub({ onChoose: (body) => asked.push(body) })
    const { result } = renderHook(() => usePluginSources())

    await act(async () => {
      await result.current.choose(MINE, "chosen")
    })
    expect(asked[0]).toMatchObject({ path: MINE })
    expect(success).toHaveBeenCalledWith("已换用这一份插件")

    await act(async () => {
      await result.current.choose("", "auto")
    })
    expect(asked[1]).toMatchObject({ path: "" })
    expect(success).toHaveBeenLastCalledWith("已改回按顺序自动找")
  })

  it("选目录：选到就换过去", async () => {
    const asked: unknown[] = []
    stub({ onChoose: (body) => asked.push(body), picks: { path: PICKED, reason: "" } })
    const { result } = renderHook(() => usePluginSources())

    await act(async () => {
      await result.current.pickFolder()
    })
    expect(asked[0]).toMatchObject({ path: PICKED })
  })

  it("选目录：取消就说一句，不动现在用的那一份", async () => {
    const asked: unknown[] = []
    const info = vi.spyOn(toast, "info")
    stub({ onChoose: (body) => asked.push(body), picks: { path: "", reason: "取消了" } })
    const { result } = renderHook(() => usePluginSources())

    await act(async () => {
      await result.current.pickFolder()
    })
    expect(asked.length).toBe(0)
    expect(info).toHaveBeenCalledWith("取消了")
  })

  it("读不到来源清单、换一份失败：都把原因说出来", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ error: { message: "连不上" } }), { status: 500 })))
    const { result } = renderHook(() => usePluginSources())
    await waitFor(() => expect(result.current.failure).not.toBe(""))

    await act(async () => {
      await result.current.choose(MINE, "chosen")
    })
    expect(result.current.failure).not.toBe("")
    expect(result.current.busy).toBe("")
  })
})
