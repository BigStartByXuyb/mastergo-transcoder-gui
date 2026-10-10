import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { usePending } from "@/app/use-pending"
import { drive } from "@/lib/settings-fixtures"

/*
 * 待确认清单只在任务停下来时读：跑着的时候清空（免得把上一轮的清单挂在行上），
 * 没有工作目录时不请求。
 */

// 夹具路径按段拼（settings-fixtures 的 drive）：源码里不出现「盘符 + 反斜杠」那种机器专属写法。
const WORK = drive("D", "w")

const PENDING = {
  ok: true,
  pending: { projectRoot: WORK, target: "T", summary: null, icons: {}, translations: {}, layout: {} }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("usePending", () => {
  it("停下来的任务读回清单一内容", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(PENDING), { status: 200 })))
    const { result } = renderHook(() =>
      usePending({ workDir: WORK, target: "T", running: false, reloadKey: "t:1" })
    )

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current?.target).toBe("T")
  })

  it("跑着的时候清空，且不请求", async () => {
    const calls: string[] = []
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(String(url))
      return Promise.resolve(new Response(JSON.stringify(PENDING), { status: 200 }))
    })
    const { result } = renderHook(() =>
      usePending({ workDir: WORK, target: "T", running: true, reloadKey: "t:1" })
    )

    await waitFor(() => expect(result.current).toBeNull())
    expect(calls).toHaveLength(0)
  })

  it("没有工作目录时不请求", async () => {
    const calls: string[] = []
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(String(url))
      return Promise.resolve(new Response(JSON.stringify(PENDING), { status: 200 }))
    })
    renderHook(() => usePending({ workDir: "", target: "T", running: false, reloadKey: "" }))

    await waitFor(() => expect(calls).toHaveLength(0))
  })
})
