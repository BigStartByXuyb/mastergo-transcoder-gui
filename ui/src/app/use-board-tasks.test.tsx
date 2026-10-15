import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useBoardTasks } from "@/app/use-board-tasks"

/*
 * 看板快照：进入时取一次，之后按节拍轮询；taskOf 从这一份快照里找任务（界面不自己存状态）。
 */

function board(tasks: { id: string }[]) {
  return { ok: true, board: { tasks: tasks, running: 0, workRoot: "" } }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useBoardTasks", () => {
  it("取到快照后按 id 找任务", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(board([{ id: "t1" }, { id: "t2" }])), { status: 200 })))
    const { result } = renderHook(() => useBoardTasks())

    await waitFor(() => expect(result.current.tasks.length).toBe(2))
    expect(result.current.taskOf("t2")).toMatchObject({ id: "t2" })
    expect(result.current.taskOf("nope")).toBeNull()
  })

  it("读不到时留着空快照，不抛异常，并把原因写在 problem 上", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")))
    const { result } = renderHook(() => useBoardTasks())

    // 后端答不上话时不报技术原文：换成「服务没在跑」那一句（说法在 describe-failure 一处）。
    await waitFor(() => expect(result.current.problem).toContain("服务没在跑"))
    expect(result.current.tasks).toEqual([])
    expect(result.current.taskOf("t1")).toBeNull()
  })

  // 一次抖动不该把界面清空：已经有快照之后读失败，保留上一份，只更新原因。
  it("已有快照之后读失败：保留上一份数据", async () => {
    let fail = false
    vi.stubGlobal("fetch", () =>
      fail
        ? Promise.resolve(
            new Response(JSON.stringify({ ok: false, error: { code: "BOARD", message: "看板读不出来", hint: "" } }), {
              status: 500
            })
          )
        : Promise.resolve(new Response(JSON.stringify(board([{ id: "t1" }])), { status: 200 }))
    )
    const { result } = renderHook(() => useBoardTasks())
    await waitFor(() => expect(result.current.tasks.length).toBe(1))

    fail = true
    await result.current.reload()
    await waitFor(() => expect(result.current.problem).toContain("看板读不出来"))
    expect(result.current.tasks.map((item) => item.id)).toEqual(["t1"])
  })
})
