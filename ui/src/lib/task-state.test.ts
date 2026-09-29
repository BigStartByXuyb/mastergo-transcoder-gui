import { describe, expect, it } from "vitest"

import type { Pending } from "@/lib/api"
import { isBusyState, isFinishedState, occupiesSlot, waitingCounts } from "@/lib/task-state"

/*
 * 这里只验证计数口径，条目的其它字段与本判定无关：按条数造空壳，
 * 造全字段会把用例变成「照抄类型定义」。
 */
function pending(patch: {
  mustName?: number
  needsNaming?: boolean
  translations?: number
  needsTranslation?: boolean
}): Pending {
  const icons = Array.from({ length: patch.mustName ?? 0 }, () => ({}))
  const texts = Array.from({ length: patch.translations ?? 0 }, () => ({}))
  return {
    projectRoot: "",
    target: "F1Align",
    summary: null,
    icons: { available: true, mustName: icons, needsNaming: patch.needsNaming ?? false },
    translations: {
      available: true,
      pendingTranslations: texts,
      needsTranslation: patch.needsTranslation ?? false
    }
  } as unknown as Pending
}

describe("task-state", () => {
  it("占额度的三个状态算运行中，跑完的状态算已完成", () => {
    for (const state of ["preparing", "running", "merging"]) expect(isBusyState(state)).toBe(true)
    expect(isBusyState("ready")).toBe(false)
    for (const state of ["ready", "merging", "merged", "conflict"]) expect(isFinishedState(state)).toBe(true)
    expect(isFinishedState("queued")).toBe(false)
  })

  it("排队与待确认也占看板这一位，但不属于「正在跑」", () => {
    for (const state of ["queued", "preparing", "running", "waiting", "merging"]) expect(occupiesSlot(state)).toBe(true)
    expect(occupiesSlot("ready")).toBe(false)
    expect(isBusyState("queued")).toBe(false)
    expect(isBusyState("waiting")).toBe(false)
  })

  it("只数真正待补的条目：needsNaming / needsTranslation 为假时不计数", () => {
    expect(waitingCounts(pending({ mustName: 3, needsNaming: true }))).toEqual({
      icons: 3,
      translations: 0,
      total: 3
    })
    expect(waitingCounts(pending({ mustName: 3, needsNaming: false, translations: 2, needsTranslation: true }))).toEqual({
      icons: 0,
      translations: 2,
      total: 2
    })
  })

  it("没有待确认清单时全是 0", () => {
    expect(waitingCounts(null)).toEqual({ icons: 0, translations: 0, total: 0 })
  })
})
