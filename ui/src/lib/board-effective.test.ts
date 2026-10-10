import { describe, expect, it } from "vitest"

import { coverageOf, pageKeyOf, visibleByCoverage } from "@/lib/board-effective"
import type { BoardTask } from "@/lib/api"

function task(
  id: string,
  state: BoardTask["state"],
  at: string,
  extra: Partial<BoardTask["request"]> = {}
): BoardTask {
  return {
    id,
    createdAt: "",
    updatedAt: "",
    state,
    stateLabel: state,
    request: {
      mode: "B",
      link: "",
      target: "F4TargetTeaching",
      ui: "F4",
      projectRoot: "P",
      fileId: "",
      layerId: "",
      stopAfter: "",
      overwrite: false,
      ...extra
    },
    jobId: "",
    workDir: "",
    routes: ["B"],
    autoMerge: true,
    progress: null,
    steps: [],
    layoutStep: "",
    aiFills: [],
    failure: null,
    merge: at ? { at, applied: [], skipped: [], notes: [], conflicts: [] } : null,
    resolutions: {},
    error: "",
    designImage: ""
  }
}

describe("pageKeyOf", () => {
  it("同一个页面的字段相同就同键，模式不同算两个页面", () => {
    expect(pageKeyOf(task("a", "merged", "1"))).toBe(pageKeyOf(task("b", "merged", "2")))
    expect(pageKeyOf(task("a", "merged", "1"))).not.toBe(pageKeyOf(task("c", "merged", "1", { mode: "A" })))
  })
})

describe("coverageOf", () => {
  it("同一页面后合并的那单生效，更早的标已被覆盖", () => {
    const coverage = coverageOf([
      task("old", "merged", "2026-09-30T01:00:00.000Z"),
      task("new", "merged", "2026-09-30T02:00:00.000Z")
    ])
    expect(coverage.get("new")).toBe("effective")
    expect(coverage.get("old")).toBe("covered")
  })

  it("没合并进工程的状态不参与比较，正在跑的那单不影响谁生效", () => {
    const coverage = coverageOf([
      task("merged", "merged", "2026-09-30T01:00:00.000Z"),
      task("running", "running", ""),
      task("conflict", "conflict", "2026-09-30T03:00:00.000Z")
    ])
    expect(coverage.get("merged")).toBe("effective")
    expect(coverage.has("running")).toBe(false)
    expect(coverage.has("conflict")).toBe(false)
  })

  it("不同页面各有一份生效", () => {
    const coverage = coverageOf([
      task("f4", "merged", "2026-09-30T01:00:00.000Z"),
      task("f3", "merged", "2026-09-30T02:00:00.000Z", { target: "F3Align" })
    ])
    expect(coverage.get("f4")).toBe("effective")
    expect(coverage.get("f3")).toBe("effective")
  })

})

describe("visibleByCoverage", () => {
  it("挑出生效的那些，并给出藏了几条", () => {
    const tasks = [
      task("old", "merged", "2026-09-30T01:00:00.000Z"),
      task("new", "merged", "2026-09-30T02:00:00.000Z"),
      task("running", "running", "")
    ]
    const coverage = coverageOf(tasks)
    const hidden = visibleByCoverage(tasks, coverage, true)
    expect(hidden.shown.map((item) => item.id)).toEqual(["new", "running"])
    expect(hidden.hidden).toBe(1)
    // 关掉开关时一条不藏，数字也要跟着归零。
    const all = visibleByCoverage(tasks, coverage, false)
    expect(all.shown.length).toBe(3)
    expect(all.hidden).toBe(0)
  })
})
