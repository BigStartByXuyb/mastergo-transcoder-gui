import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LayoutTree } from "@/app/layout-tree"
import { bands, cell } from "@/lib/layout-fixtures"
import type { DerivedLayout, LayoutControl } from "@/lib/api"

/*
 * 布局树：显示的是**推导出来的**布局，摆成正常的树 —— 分区 → 组（装着东西的格子，可以再套）→ 控件。
 * 组行写它是这一层里的第几个组、往哪个方向排，控件行写它在清单里的号加名字；
 * 点一行把它盖住的控件交出去（画布据此描边）。
 * 没有推导产物时只说一句原因，还没读到（null）时这块不摆。
 */

function control(ref: string, controlType: string, text: string): LayoutControl {
  return { ref: ref, controlType: controlType, text: text, absX: 0, absY: 0, w: 10, h: 10 }
}

const CONTROLS = [
  control("1:9", "IconButton", "确定"),
  control("1:10", "IconButton", ""),
  control("1:11", "TextBlock", "标题"),
  control("1:12", "TextBlock", "说明"),
  control("9:5", "GroupBox", "")
]

/*
 * 一份推导结果（同层已按行列排好 —— 那是读视图的活，见 tests/derived-layout.test.js）。
 * 9:5 是清单里的 GroupBox、自己也装着东西（组行写出它的号与名字）；9:9 是产物合成出来的容器（垂直布局），
 * 它里面又套着一个水平布局的组。
 */
const DERIVED: DerivedLayout = {
  available: true,
  reason: "",
  regions: [
    { id: "top-strip", name: "顶部栏", emit: false, bands: bands(0, 0), cells: [] },
    {
      id: "work-area",
      name: "工作区",
      emit: true,
      bands: bands(4, 3, [3], [3]),
      cells: [
        cell("1:9", "IconButton"),
        cell("1:10", "IconButton"),
        cell("1:11", "TextBlock"),
        cell("9:5", "GroupBox", [cell("1:12", "TextBlock")]),
        cell("9:9", "", [
          cell("9:20", "NumberBox"),
          cell("9:30", "", [cell("9:31", "TextBlock")], "row", bands(1, 2))
        ], "column", bands(2, 1, [2]))
      ]
    }
  ],
  // 摆不进树的那一条：产物没给行列坐标（它不在树上）。
  unplaced: [{ ref: "1:13", reason: "推导产物里这一格没有行列坐标" }],
  // 插件报的单条目栏：它在树上有位置（#2 IconButton），只是没进任何组。
  singles: [{ ref: "1:10", reason: "单条目栏：几何判不出它跟谁同组，分组表里也没有它" }]
}

function tree(overrides: { derived?: DerivedLayout | null; selected?: string; onPick?: (key: string, refs: string[]) => void } = {}) {
  return (
    <LayoutTree
      derived={overrides.derived === undefined ? DERIVED : overrides.derived}
      controls={CONTROLS}
      selected={overrides.selected ?? ""}
      onPick={overrides.onPick ?? (() => undefined)}
    />
  )
}

describe("LayoutTree", () => {
  it("还没读到这一页（null）：这块不摆", () => {
    const { container } = render(tree({ derived: null }))
    expect(container.innerHTML).toBe("")
  })

  it("没有推导产物时：只说一句原因，不摆空的树", () => {
    const { container } = render(
      tree({
        derived: { available: false, reason: "还没有推导产物：布局那一步跑完之后…", regions: [], unplaced: [], singles: [] }
      })
    )
    expect(screen.getByText(/还没有推导产物/)).toBeTruthy()
    expect(container.querySelectorAll("button").length).toBe(0)
  })

  it("分区 → 组 → 控件逐层缩进：组行写方向，控件行写清单里的号", () => {
    render(tree())

    expect(screen.getByText("顶部栏 · 只注册")).toBeTruthy()
    expect(screen.getByText("工作区 · 发射 · 4 行 × 3 列 · 第 3 行、第 3 列吃剩余（*）")).toBeTruthy()

    // 逐层摆下来：组行下面接着它自己那一层（缩进更深）。
    const labels = [...document.querySelectorAll("button")].map((node) => node.textContent)
    expect(labels).toEqual([
      "顶部栏 · 只注册",
      "工作区 · 发射 · 4 行 × 3 列 · 第 3 行、第 3 列吃剩余（*）",
      "#1 确定",
      "#2 IconButton",
      "#3 标题",
      "组 1（方向不明） · #5 GroupBox",
      "#4 说明",
      "组 2（垂直布局） · 第 2 行吃剩余（*）",
      "NumberBox",
      "组 1（水平布局）",
      "TextBlock",
      "摆不进树的 1 个",
      "插件报的单条目栏 · 1 个"
    ])
  })

  it("组的序号按「这一层里的第几个组」算，方向与吃剩余的带都照产物给", () => {
    render(tree())

    // 清单里没有的容器：只有方向（不编名字）；清单里的 GroupBox：连它的号与名字一起写。
    expect(screen.getByText("组 2（垂直布局） · 第 2 行吃剩余（*）")).toBeTruthy()
    expect(screen.getByText("组 1（方向不明） · #5 GroupBox")).toBeTruthy()
    // 嵌套的组各按自己那一层重新数号。
    expect(screen.getByText("组 1（水平布局）")).toBeTruthy()
  })

  it("摆不进树的与插件报的单条目栏各摆一块，原因在悬停提示里", () => {
    render(tree())

    expect(screen.getByText("摆不进树的 1 个")).toBeTruthy()
    expect(screen.getByText("1:13").getAttribute("title")).toBe("推导产物里这一格没有行列坐标")
    expect(screen.getByText("插件报的单条目栏 · 1 个")).toBeTruthy()
    /* 这一条在树上也有位置（同一个 ref 两处出现）：按悬停提示认这一条。 */
    const single = screen.getByTitle("单条目栏：几何判不出它跟谁同组，分组表里也没有它")
    expect(single.textContent).toBe("#2 IconButton")
  })

  it("点一行：交出它盖住的控件（分区 / 组 / 控件 / 两份读数各有各的）", () => {
    const picked = vi.fn()
    render(tree({ onPick: picked }))

    fireEvent.click(screen.getByText("工作区 · 发射 · 4 行 × 3 列 · 第 3 行、第 3 列吃剩余（*）"))
    expect(picked).toHaveBeenLastCalledWith(expect.any(String), [
      "1:9", "1:10", "1:11", "9:5", "1:12", "9:9", "9:20", "9:30", "9:31"
    ])

    // 点组：这一组里全部的控件（含它自己与套着的几层）。
    fireEvent.click(screen.getByText("组 2（垂直布局） · 第 2 行吃剩余（*）"))
    expect(picked).toHaveBeenLastCalledWith(expect.any(String), ["9:9", "9:20", "9:30", "9:31"])

    // 点控件：就是它自己。
    fireEvent.click(screen.getByText("#3 标题"))
    expect(picked).toHaveBeenLastCalledWith(expect.any(String), ["1:11"])

    // 嵌套那一层：是另一行（另一份控件）。
    fireEvent.click(screen.getByText("TextBlock"))
    expect(picked).toHaveBeenLastCalledWith(expect.any(String), ["9:31"])

    fireEvent.click(screen.getByText("摆不进树的 1 个"))
    expect(picked).toHaveBeenLastCalledWith(expect.any(String), ["1:13"])

    fireEvent.click(screen.getByText("插件报的单条目栏 · 1 个"))
    expect(picked).toHaveBeenLastCalledWith(expect.any(String), ["1:10"])

    // 每一次点到的都是不同的一行：交出去的 key 两两不同（key 怎么拼由组件自己定，调用方不解析）。
    const keys = picked.mock.calls.map((call) => call[0])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("选中态由调用方给：把它收到的那个 key 回传，那一行就标出来（组件里不另存一份）", () => {
    const picked = vi.fn()
    const view = render(tree({ onPick: picked }))

    fireEvent.click(screen.getByText("组 2（垂直布局） · 第 2 行吃剩余（*）"))
    const key = picked.mock.calls[0][0]
    view.rerender(tree({ selected: key, onPick: picked }))

    expect(screen.getByText("组 2（垂直布局） · 第 2 行吃剩余（*）").getAttribute("data-selected")).toBe("true")
    expect(screen.getByText("组 1（方向不明） · #5 GroupBox").getAttribute("data-selected")).toBe("false")
  })
})
