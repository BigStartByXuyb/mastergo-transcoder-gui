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

  it("读不到时留着空快照，不抛异常", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")))
    const { result } = renderHook(() => useBoardTasks())

    await waitFor(() => expect(result.current.tasks).toEqual([]))
    expect(result.current.taskOf("t1")).toBeNull()
  })
})
