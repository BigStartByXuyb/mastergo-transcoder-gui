import { describe, expect, it } from "vitest"

import { taskEntryFailure } from "@/app/task-creation-entry"
import type { Board, BoardModePolicy } from "@/lib/api"

const empty: Board = { workRoot: "", limits: { logical: 1, limit: 1 }, running: 0, tasks: [] }
const policy: BoardModePolicy = {
  mode: "B",
  routes: ["B"],
  takesPageImage: false,
  startsWithPipelineA: false
}

describe("taskEntryFailure", () => {
  it("两个入口用同一套顺序判断工程、链接与路线能力", () => {
    expect(taskEntryFailure({ projectRoot: "", links: [], board: empty, policy: null })).toBe("先填工程目录")
    expect(taskEntryFailure({ projectRoot: "p", links: [], board: empty, policy: null }))
      .toBe("一行一个 MasterGo 链接，至少一行")
    expect(taskEntryFailure({ projectRoot: "p", links: ["https://a"], board: empty, policy: null }))
      .toBe("当前记住的路线已不可用，请重新选择路线")
    expect(taskEntryFailure({ projectRoot: "p", links: ["https://a"], board: null, policy: null }))
      .toBe("路线能力还没读到，请稍后重试")
    expect(taskEntryFailure({ projectRoot: "p", links: ["https://a"], board: empty, policy })).toBe("")
  })
})
