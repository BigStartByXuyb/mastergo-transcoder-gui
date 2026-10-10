import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useTaskActions } from "@/app/use-task-actions"
import type { BoardTask } from "@/lib/api"
import { drive } from "@/lib/settings-fixtures"

/*
 * 任务上的动作：调后端 → 把后端回的最新看板/运行换到界面 → 失败原话交出去。
 * 六个动作的口径只在这里，页面只接按钮。
 */

// 夹具路径按段拼（settings-fixtures 的 drive）：源码里不出现机器专属的盘符写法。
const TASK = {
  id: "t1",
  jobId: "job-1",
  workDir: drive("D", "w"),
  request: { target: "T" },
  state: "failed"
} as unknown as BoardTask

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

function bad(code: string, message: string) {
  return Promise.resolve(new Response(JSON.stringify({ ok: false, error: { code, message, hint: "" } }), { status: 400 }))
}

function harness(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => handler(String(url), init))
  const boards: unknown[] = []
  const failures: string[] = []
  const jobs: unknown[] = []
  let gone = 0
  const { result } = renderHook(() =>
    useTaskActions({
      onBoard: (board) => boards.push(board),
      onPlugin: () => undefined,
      onJob: (job) => jobs.push(job),
      onJobReset: () => undefined,
      onFailure: (message) => failures.push(message),
      onTaskGone: () => {
        gone += 1
      }
    })
  )
  return { result, boards, failures, jobs, goneCount: () => gone }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useTaskActions", () => {
  it("开始：建任务 + 启动，两次都把最新看板换上去，并回建出来的任务 id", async () => {
    const fx = harness((url) => (url.includes("/api/board/add") ? ok({ ok: true, board: { tasks: [] }, created: ["t9"] }) : ok({ ok: true, board: { tasks: [{ id: "t9" }] } })))

    let created = ""
    await act(async () => {
      const added = await fx.result.current.start({
        projectRoot: drive("D", "p"),
        ui: "F4",
        autoMerge: true,
        stopAfter: "",
        overwrite: false,
        items: [{ link: "https://mastergo.com/goto/x?file=1&layer_id=2", target: "T", mode: "A" }]
      })
      created = added.created[0] ?? ""
    })
    await act(async () => {
      await fx.result.current.startJob(created)
    })

    expect(created).toBe("t9")
    expect(fx.boards.length).toBe(2)
  })

  it("续跑：换掉界面上的运行与日志起点，并把后端给的说法提示出来", async () => {
    const fx = harness(() => ok({ ok: true, mode: "A", resumedFrom: "layout", job: { id: "job-2" } }))

    await act(async () => {
      await fx.result.current.resume(TASK)
    })

    expect(fx.jobs).toEqual([{ id: "job-2" }])
    expect(fx.failures).toEqual([""])
  })

  it("行已经不在了（NO_TASK）：把看板拉回最新", async () => {
    const fx = harness(() => bad("NO_TASK", "这条任务已经不在看板上"))

    await act(async () => {
      await fx.result.current.resume(TASK)
    })

    expect(fx.goneCount()).toBe(1)
    expect(fx.failures[fx.failures.length - 1]).toContain("已经不在看板")
  })

  it("合并与冲突裁决：各把回来的看板换上去", async () => {
    const fx = harness((url) => ok({ ok: true, board: { tasks: [], via: url.includes("resolve") ? "resolve" : "merge" } }))

    await act(async () => {
      fx.result.current.merge(TASK)
    })
    await waitFor(() => expect(fx.boards.length).toBe(1))

    await act(async () => {
      await fx.result.current.resolveConflict(TASK, "UI/a.xaml", "mine")
    })
    await waitFor(() => expect(fx.boards.length).toBe(2))
    expect(fx.boards[1]).toMatchObject({ via: "resolve" })
  })
})
