import { describe, expect, it } from "vitest"

import { boardStateVariant } from "@/lib/board-state"

describe("boardStateVariant", () => {
  it("已合并用次要色，失败与冲突用破坏色", () => {
    expect(boardStateVariant("merged")).toBe("secondary")
    expect(boardStateVariant("failed")).toBe("destructive")
    expect(boardStateVariant("conflict")).toBe("destructive")
  })

  it("运行中与合并中用实心", () => {
    expect(boardStateVariant("running")).toBe("default")
    expect(boardStateVariant("merging")).toBe("default")
  })

  it("其余状态（排对、待确认、待合并、已停止）一律描边", () => {
    for (const state of ["queued", "preparing", "waiting", "ready", "stopped", "unknown"]) {
      expect(boardStateVariant(state)).toBe("outline")
    }
  })
})
