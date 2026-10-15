import { describe, expect, it } from "vitest"

import { clampPage, pageCount, pageSlice } from "@/lib/paging"

describe("pageCount", () => {
  it("按每页条数向上取整，空列表也算一页", () => {
    expect(pageCount(0, 5)).toBe(1)
    expect(pageCount(1, 5)).toBe(1)
    expect(pageCount(5, 5)).toBe(1)
    expect(pageCount(6, 5)).toBe(2)
    expect(pageCount(11, 5)).toBe(3)
  })

  it("每页条数不合法时退成一页", () => {
    expect(pageCount(9, 0)).toBe(1)
  })
})

describe("clampPage", () => {
  it("页码夹在有效范围内", () => {
    expect(clampPage(0, 12, 5)).toBe(1)
    expect(clampPage(-3, 12, 5)).toBe(1)
    expect(clampPage(2, 12, 5)).toBe(2)
    expect(clampPage(9, 12, 5)).toBe(3)
    expect(clampPage(Number.NaN, 12, 5)).toBe(1)
  })
})

describe("pageSlice", () => {
  const items = [1, 2, 3, 4, 5, 6, 7]

  it("切出这一页", () => {
    expect(pageSlice(items, 1, 3)).toEqual([1, 2, 3])
    expect(pageSlice(items, 3, 3)).toEqual([7])
  })

  // 删到只剩几行时，界面还停在老的页码上会显示空列表 —— 这里自动落到最后一页。
  it("页码越界时落到最后一页，而不是给空表", () => {
    expect(pageSlice(items, 9, 3)).toEqual([7])
    expect(pageSlice([], 4, 3)).toEqual([])
  })

  it("每页条数为 0 时不分页", () => {
    expect(pageSlice(items, 2, 0)).toEqual(items)
  })
})
