import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LayoutTree } from "@/app/layout-tree"
import type { DerivedLayout, LayoutCell, LayoutChild, LayoutControl } from "@/lib/api"

/*
 * 布局树：显示的是**推导出来的**布局，摆成正常的树 —— 分区 → 组（分区里的某一行）→ 格子 → 格子里的格子。
 * 控件行带它在清单里的号，组行带它在这一页里的号；点一行把这一行盖住的控件交出去（画布据此描边）。
 * 没有推导产物时只说一句原因，还没读到（null）时这块不摆。
 */

function control(ref: string, controlType: string, text: string): LayoutControl {
  return { ref: ref, controlType: controlType, text: text, absX: 0, absY: 0, w: 10, h: 10 }
}

/* 子网格里的一格：它挂在父格子下，所以不带行列。 */
function child(ref: string, controlType: string, children: LayoutChild[] = []): LayoutChild {
  return { ref: ref, controlType: controlType, rowSpan: 1, columnSpan: 1, children: children }
}

function cell(ref: string, controlType: string, row: number, column: number, children: LayoutChild[] = []): LayoutCell {
  return { ref: ref, controlType: controlType, row: row, column: column, rowSpan: 1, columnSpan: 1, children: children }
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
        /*
         * 产物合成出来的容器（ref 带 synth: 前缀）：它里面既列着「容器自己」那一条，也装着清单里没有的控件。
         * 容器自己那一条不该在树上再占一行。
         */
        cell("synth:9:9", "", 3, 1, [child("9:9", "", [child("9:20", "NumberBox")])])
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
    expect(screen.getByText("工作区 · 发射")).toBeTruthy()
    expect(screen.getByText("组 #1")).toBeTruthy()
    expect(screen.getByText("组 #2")).toBeTruthy()
    expect(screen.getByText("组 #3")).toBeTruthy()
    expect(screen.getByText("#1 确定")).toBeTruthy()
    // 没有 value 的控件：号 + 它的控件类型。
    expect(screen.getByText("#2 IconButton")).toBeTruthy()
    expect(screen.getByText("#3 标题")).toBeTruthy()
    // 没有格子的分区不列组。
    expect(screen.queryByText("组 #4")).toBeNull()
  })

  it("容器与它里面的格子往下摆一层；清单里没有的用产物给的类型", () => {
    render(<LayoutTree derived={DERIVED} controls={CONTROLS} selected="" onPick={() => undefined} />)

    expect(screen.getByText("9:9（容器）")).toBeTruthy()
    expect(screen.getByText("NumberBox")).toBeTruthy()
    // 容器自己那一条不再占一行。
    expect(screen.queryByText("9:9")).toBeNull()
  })

  it("点一行：交出它的 key（分区 / 组 / 格子 / 容器里的格子 / 没归宿各有各的）", () => {
    const picked = vi.fn()
    render(<LayoutTree derived={DERIVED} controls={CONTROLS} selected="" onPick={picked} />)

    fireEvent.click(screen.getByText("工作区 · 发射"))
    expect(picked).toHaveBeenLastCalledWith("region:work-area")

    fireEvent.click(screen.getByText("组 #1"))
    expect(picked).toHaveBeenLastCalledWith("region:work-area#g1")

    fireEvent.click(screen.getByText("#3 标题"))
    expect(picked).toHaveBeenLastCalledWith("region:work-area#g2/ref:1:11")

    // 容器里那一格：路径多一段。
    fireEvent.click(screen.getByText("NumberBox"))
    expect(picked).toHaveBeenLastCalledWith("region:work-area#g3/ref:synth:9:9/ref:9:9/ref:9:20")

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
          cells: [{ ref: "1:9", controlType: "IconButton", row: 2, column: 1, rowSpan: 2, columnSpan: 1, children: [] }]
        }
      ],
      unresolved: []
    }
    render(<LayoutTree derived={spanning} controls={CONTROLS} selected="" onPick={() => undefined} />)

    expect(screen.getByText("组 #1")).toBeTruthy()
    expect(screen.getByText("组 #2")).toBeTruthy()
    expect(screen.getAllByText("#1 确定（跨 2 行 × 1 列）").length).toBe(1)
  })

  it("选中的那一行标出来（选中态由调用方给，不在组件里另存一份）", () => {
    render(<LayoutTree derived={DERIVED} controls={CONTROLS} selected="region:work-area#g1" onPick={() => undefined} />)
    expect(screen.getByText("组 #1").getAttribute("data-selected")).toBe("true")
    expect(screen.getByText("组 #2").getAttribute("data-selected")).toBe("false")
  })
})
