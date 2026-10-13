import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LayoutTree } from "@/app/layout-tree"
import type { DerivedLayout, LayoutControl } from "@/lib/api"
import { cell, child } from "@/lib/layout-fixtures"

/*
 * 布局树：显示的是**推导出来的**布局，摆成正常的树 —— 分区 → 组（分区里的某一行）→ 格子 → 格子里的格子。
 * 控件行带它在清单里的号，组行带它在这一页里的号；点一行把这一行盖住的控件交出去（画布据此描边）。
 * 没有推导产物时只说一句原因，还没读到（null）时这块不摆。
 */

function control(ref: string, controlType: string, text: string): LayoutControl {
  return { ref: ref, controlType: controlType, text: text, absX: 0, absY: 0, w: 10, h: 10 }
}

const CONTROLS = [
  control("1:9", "IconButton", "确定"),
  control("1:10", "IconButton", ""),
  control("1:11", "TextBlock", "标题"),
  control("1:12", "TextBlock", "说明")
]

const DERIVED: DerivedLayout = {
  available: true,
  reason: "",
  regions: [
    { id: "top-strip", name: "顶部栏", emit: false, cells: [] },
    {
      id: "work-area",
      name: "工作区",
      emit: true,
      cells: [
        cell("1:9", "IconButton", 1, 2),
        cell("1:10", "IconButton", 1, 3),
        cell("1:11", "TextBlock", 2, 1),
        /* 产物合成出来的容器（读视图把它标成 container）：它里面装着清单里没有的控件。 */
        cell("9:9", "", 3, 1, [child("9:20", "NumberBox")], true)
      ]
    }
  ],
  // 没归宿的那几条：插件给的原因留在悬停提示里。
  unresolved: [{ ref: "1:12", reason: "单条目栏：几何判不出它跟谁同组" }]
}

describe("LayoutTree", () => {
  it("还没读到这一页（null）：这块不摆", () => {
    const { container } = render(<LayoutTree derived={null} controls={CONTROLS} selected="" onPick={() => undefined} />)
    expect(container.innerHTML).toBe("")
  })

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

  it("分区 → 组 → 格子逐层缩进，控件带清单里的号", () => {
    render(<LayoutTree derived={DERIVED} controls={CONTROLS} selected="" onPick={() => undefined} />)

    expect(screen.getByText("顶部栏 · 只注册")).toBeTruthy()
    expect(screen.getByText("工作区 · 发射 · 3 行 × 3 列")).toBeTruthy()
    // 这一组里有两个格子：它们在那一行里左右排。
    expect(screen.getByText("第 1 行（横排）")).toBeTruthy()
    expect(screen.getByText("第 2 行")).toBeTruthy()
    expect(screen.getByText("第 3 行")).toBeTruthy()
    expect(screen.getByText("#1 确定")).toBeTruthy()
    // 没有 value 的控件：号 + 它的控件类型。
    expect(screen.getByText("#2 IconButton")).toBeTruthy()
    expect(screen.getByText("#3 标题")).toBeTruthy()
    // 没有格子的分区不列组。
    expect(screen.queryByText("第 4 行")).toBeNull()
  })

  it("容器与它里面的格子往下摆一层；清单里没有的用产物给的类型", () => {
    render(<LayoutTree derived={DERIVED} controls={CONTROLS} selected="" onPick={() => undefined} />)

    expect(screen.getByText("容器 9:9（组：方向不明）")).toBeTruthy()
    expect(screen.getByText("NumberBox")).toBeTruthy()
  })

  it("点一行：交出它的 key（分区 / 组 / 格子 / 容器里的格子 / 没归宿各有各的）", () => {
    const picked = vi.fn()
    render(<LayoutTree derived={DERIVED} controls={CONTROLS} selected="" onPick={picked} />)

    fireEvent.click(screen.getByText("工作区 · 发射 · 3 行 × 3 列"))
    expect(picked).toHaveBeenLastCalledWith("region:work-area")

    fireEvent.click(screen.getByText("第 1 行（横排）"))
    expect(picked).toHaveBeenLastCalledWith("region:work-area#group:1")

    fireEvent.click(screen.getByText("#3 标题"))
    expect(picked).toHaveBeenLastCalledWith("region:work-area#group:2/ref:1:11")

    // 容器里那一格：路径多一段。
    fireEvent.click(screen.getByText("NumberBox"))
    expect(picked).toHaveBeenLastCalledWith("region:work-area#group:3/ref:9:9/ref:9:20")

    fireEvent.click(screen.getByText("没归宿的 1 个"))
    expect(picked).toHaveBeenLastCalledWith("unresolved")
  })

  it("跨行的格子：只在它起始的那一组里列一次，并标出跨了几行", () => {
    const spanning: DerivedLayout = {
      available: true,
      reason: "",
      regions: [
        {
          id: "work-area",
          name: "工作区",
          emit: true,
          cells: [{ ...cell("1:9", "IconButton", 2, 1), rowSpan: 2 }]
        }
      ],
      unresolved: []
    }
    render(<LayoutTree derived={spanning} controls={CONTROLS} selected="" onPick={() => undefined} />)

    expect(screen.getByText("工作区 · 发射 · 2 行 × 1 列")).toBeTruthy()
    expect(screen.getByText("第 1 行")).toBeTruthy()
    expect(screen.getByText("第 2 行")).toBeTruthy()
    expect(screen.getAllByText("#1 确定（跨 2 行 × 1 列）").length).toBe(1)
  })

  it("选中的那一行标出来（选中态由调用方给，不在组件里另存一份）", () => {
    render(<LayoutTree derived={DERIVED} controls={CONTROLS} selected="region:work-area#group:1" onPick={() => undefined} />)
    expect(screen.getByText("第 1 行（横排）").getAttribute("data-selected")).toBe("true")
    expect(screen.getByText("第 2 行").getAttribute("data-selected")).toBe("false")
  })
})
