import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useRunLog } from "@/app/use-run-log"

/*
 * 运行日志：轮询只在运行中开着，跑完就停；jobId 变了必须从零开始。
 * 节拍是 1500ms，这里等真实时间（timeout 放宽）——改成假定时器会让 fetch 的微任务时序更脆。
 */

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

function jobBody(state: string) {
  return { ok: true, job: { id: "job-1", createdAt: "", state, request: {}, plan: [], runs: [], log: { base: 0, next: 0 }, error: "" }, steps: [] }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useRunLog", () => {
  it("没有运行 id 时不请求状态", async () => {
    const calls: string[] = []
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(String(url))
      return ok({ ok: true })
    })
    const { result } = renderHook(() => useRunLog(""))
    await waitFor(() => expect(result.current.job).toBeNull())
    expect(calls).toHaveLength(0)
  })

  it("运行中按节拍把增量日志接在后面", async () => {
    let slice = 0
    vi.stubGlobal("fetch", (url: string) => {
      const href = String(url)
      if (href.includes("/api/run/status")) return ok(jobBody("running"))
      if (href.includes("/api/run/log")) {
        slice += 1
        return ok({ ok: true, from: 0, next: slice, truncated: false, text: "第" + slice + "段\n" })
      }
      return ok({ ok: true })
    })
    const { result } = renderHook(() => useRunLog("job-1"))
    await waitFor(() => expect(result.current.job?.state).toBe("running"))
    await waitFor(() => expect(result.current.logText).toContain("第1段"), { timeout: 4000 })
    await waitFor(() => expect(result.current.logText).toContain("第2段"), { timeout: 4000 })
  })

  it("跑完就停止轮询，日志不再增长", async () => {
    let logCalls = 0
    vi.stubGlobal("fetch", (url: string) => {
      const href = String(url)
      if (href.includes("/api/run/status")) return ok(jobBody("done"))
      if (href.includes("/api/run/log")) {
        logCalls += 1
        return ok({ ok: true, from: 0, next: 1, truncated: false, text: "只有一次\n" })
      }
      return ok({ ok: true })
    })
    const { result } = renderHook(() => useRunLog("job-1"))
    await waitFor(() => expect(result.current.job?.state).toBe("done"))
    await new Promise((resolve) => setTimeout(resolve, 1800))
    expect(logCalls).toBe(0)
    expect(result.current.logText).toBe("")
  })

  it("日志被截断时整段替换，不拼接", async () => {
    let first = true
    vi.stubGlobal("fetch", (url: string) => {
      const href = String(url)
      if (href.includes("/api/run/status")) return ok(jobBody("running"))
      if (href.includes("/api/run/log")) {
        if (first) {
          first = false
          return ok({ ok: true, from: 0, next: 10, truncated: false, text: "旧\n" })
        }
        return ok({ ok: true, from: 10, next: 20, truncated: true, text: "新（服务端只留了尾部）\n" })
      }
      return ok({ ok: true })
    })
    const { result } = renderHook(() => useRunLog("job-1"))
    await waitFor(() => expect(result.current.logText).toContain("旧"), { timeout: 4000 })
    await waitFor(() => expect(result.current.logText).toBe("新（服务端只留了尾部）\n"), { timeout: 4000 })
  })
})
