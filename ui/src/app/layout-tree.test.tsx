import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LayoutTree } from "@/app/layout-tree"
import type { DerivedLayout, LayoutControl } from "@/lib/api"
import { refsOfDerived } from "@/lib/layout-edit"

/*
 * 布局树：显示的是**推导出来的**布局（分区 → 行/列 → 格子），不是设计稿原始层级。
 * 点一行把这一行盖住的控件交出去（画布据此描边）；没有推导产物时只说一句原因。
 * 控件那一行按 value 显示（没有 value 退回控件类型），末尾带清单里的号。
 */

function control(ref: string, controlType: string, text: string): LayoutControl {
  return { ref: ref, controlType: controlType, text: text, absX: 0, absY: 0, w: 10, h: 10 }
}

const CONTROLS = [
  control("1:9", "IconButton", "确定"),
  control("1:10", "IconButton", ""),
  control("1:11", "TextBlock", "标题")
]

const DERIVED: DerivedLayout = {
  available: true,
  reason: "",
  regions: [
    {
      id: "top-strip",
      name: "顶部栏",
      emit: false,
      rows: 1,
      columns: 1,
      cells: []
    },
    {
      id: "work-area",
      name: "工作区",
      emit: true,
      rows: 2,
      columns: 3,
      cells: [
        { ref: "1:9", row: 1, column: 2, rowSpan: 1, columnSpan: 1 },
        { ref: "1:10", row: 1, column: 3, rowSpan: 1, columnSpan: 1 },
        { ref: "1:11", row: 2, column: 1, rowSpan: 1, columnSpan: 1 }
      ]
    }
  ],
  unresolved: [{ ref: "1:11", reason: "单条目栏：几何判不出它跟谁同组" }]
}

describe("LayoutTree", () => {
  it("没有推导产物时：只说一句原因，不摆空的树", () => {
    const { container } = render(
      <LayoutTree
        derived={{ available: false, reason: "还没有推导产物：布局那一步跑完之后…", regions: [], unresolved: [] }}
        controls={CONTROLS}
        selected=""
        onPick={() => undefined}
      />
    )
    expect(screen.getByText(/还没有推导产物/)).toBeTruthy()
    expect(container.querySelectorAll("button").length).toBe(0)
  })

  it("分区 / 行 / 格子各就各位，控件按 value 显示并带号", () => {
    render(<LayoutTree derived={DERIVED} controls={CONTROLS} selected="" onPick={() => undefined} />)

    expect(screen.getByText("顶部栏 · 只注册 · 1 行 × 1 列")).toBeTruthy()
    expect(screen.getByText("工作区 · 发射 · 2 行 × 3 列")).toBeTruthy()
    expect(screen.getByText("第 1 行")).toBeTruthy()
    expect(screen.getByText("第 2 行")).toBeTruthy()
    expect(screen.getByText("确定 · #1（第 2 列）")).toBeTruthy()
    // 没有 value 的控件退回它的控件类型。
    expect(screen.getByText("IconButton · #2（第 3 列）")).toBeTruthy()
    expect(screen.getByText("标题 · #3（第 1 列）")).toBeTruthy()
    expect(screen.getByText("没归宿的 1 个")).toBeTruthy()
  })

  it("点一行：把这一行盖住的控件交出去（分区 / 行 / 单个控件 / 没归宿各一条路）", () => {
    const picked = vi.fn()
    render(<LayoutTree derived={DERIVED} controls={CONTROLS} selected="" onPick={picked} />)

    fireEvent.click(screen.getByText("第 1 行"))
    expect(picked).toHaveBeenLastCalledWith("region:work-area#row:1")

    fireEvent.click(screen.getByText("工作区 · 发射 · 2 行 × 3 列"))
    expect(picked).toHaveBeenLastCalledWith("region:work-area")

    fireEvent.click(screen.getByText("标题 · #3（第 1 列）"))
    expect(picked).toHaveBeenLastCalledWith("ref:1:11")

    fireEvent.click(screen.getByText("没归宿的 1 个"))
    expect(picked).toHaveBeenLastCalledWith("unresolved")
  })

  it("key → 要描的控件：分区给全部分区里的，行给那一行的，单个控件给一个，没归宿给那几条", () => {
    expect(refsOfDerived(DERIVED, "region:work-area")).toEqual(["1:9", "1:10", "1:11"])
    expect(refsOfDerived(DERIVED, "region:work-area#row:1")).toEqual(["1:9", "1:10"])
    expect(refsOfDerived(DERIVED, "region:work-area#row:2")).toEqual(["1:11"])
    expect(refsOfDerived(DERIVED, "region:top-strip")).toEqual([])
    expect(refsOfDerived(DERIVED, "ref:1:9")).toEqual(["1:9"])
    // 跨行的格子那条行 key 带「分区 + 行」前缀，解析时只看最后一段。
    expect(refsOfDerived(DERIVED, "region:work-area#row:1/ref:1:9")).toEqual(["1:9"])
    expect(refsOfDerived(DERIVED, "unresolved")).toEqual(["1:11"])
    expect(refsOfDerived(DERIVED, "")).toEqual([])
  })

  it("跨行的格子：它盖住的每一行都算有它，行列表也把它铺开", () => {
    const spanning: DerivedLayout = {
      available: true,
      reason: "",
      regions: [
        {
          id: "work-area",
          name: "工作区",
          emit: true,
          rows: 3,
          columns: 1,
          cells: [{ ref: "1:9", row: 2, column: 1, rowSpan: 2, columnSpan: 1 }]
        }
      ],
      unresolved: []
    }
    expect(refsOfDerived(spanning, "region:work-area#row:1")).toEqual([])
    expect(refsOfDerived(spanning, "region:work-area#row:2")).toEqual(["1:9"])
    expect(refsOfDerived(spanning, "region:work-area#row:3")).toEqual(["1:9"])
    render(<LayoutTree derived={spanning} controls={CONTROLS} selected="" onPick={() => undefined} />)
    expect(screen.getByText("第 2 行")).toBeTruthy()
    expect(screen.getByText("第 3 行")).toBeTruthy()
    // 跨行的格子，它盖住的两行里各出现一次。
    expect(screen.getAllByText("确定 · #1（第 1 列，跨 2 行 × 1 列）").length).toBe(2)
  })

  it("选中的那一行标出来（选中态由调用方给，不在组件里另存一份）", () => {
    render(<LayoutTree derived={DERIVED} controls={CONTROLS} selected="region:work-area" onPick={() => undefined} />)
    expect(screen.getByText("工作区 · 发射 · 2 行 × 3 列").getAttribute("data-selected")).toBe("true")
    expect(screen.getByText("第 1 行").getAttribute("data-selected")).toBe("false")
  })
})
