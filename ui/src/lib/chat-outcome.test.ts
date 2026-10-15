import { describe, expect, it } from "vitest"

import { judgeTurnOutcome } from "@/lib/chat-outcome"

const base = { code: 0, turnDone: true, stopped: false, alreadyFailed: false }

describe("judgeTurnOutcome", () => {
  it("收尾干净就是跑成了", () => {
    expect(judgeTurnOutcome(base)).toEqual({ failed: false, message: "" })
  })

  it("人自己点停下不算失败", () => {
    expect(judgeTurnOutcome({ ...base, turnDone: false, stopped: true })).toEqual({ failed: false, message: "" })
  })

  it("退出码非 0 算失败，带退出码那句话", () => {
    expect(judgeTurnOutcome({ ...base, code: 1 })).toEqual({
      failed: true,
      message: "Codex 退出码 1；下面是引擎日志。"
    })
  })

  it("退出码 0 却没收到收尾，也算失败", () => {
    expect(judgeTurnOutcome({ ...base, turnDone: false })).toEqual({
      failed: true,
      message: "这一轮没有正常收尾；下面是引擎日志。"
    })
  })

  it("已经报过原因就不再盖第二句话", () => {
    expect(judgeTurnOutcome({ ...base, code: 2, alreadyFailed: true })).toEqual({ failed: true, message: "" })
  })
})
