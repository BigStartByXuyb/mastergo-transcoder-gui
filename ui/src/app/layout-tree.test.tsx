import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LayoutTree } from "@/app/layout-tree"
import type { LayoutControl, LayoutTreeNode } from "@/lib/api"

/*
 * 层次图：一段一段摆出来，点一段就把这段（连同它下面的段）里的控件交出去（画布据此描边）。
 * 号由 numberOf 现算（「控件号＝它在清单里的次序」只有那一处实现），树只给层级。
 */

function control(ref: string, controlType: string, text: string): LayoutControl {
  return { ref: ref, controlType: controlType, text: text, absX: 0, absY: 0, w: 10, h: 10 }
}

const CONTROLS = [
  control("a", "IconButton", "确定"),
  control("b", "IconButton", "取消"),
  control("c", "TextBlock", "标题")
]

const NODES: LayoutTreeNode[] = [
  {
    ref: "root",
    name: "",
    type: "FRAME",
    flow: "",
    children: [
      {
        ref: "bar",
        name: "RightTools",
        type: "FRAME",
        flow: "column",
        children: [
          { ref: "a", name: "", type: "IconButton", flow: "", children: [] },
          { ref: "b", name: "", type: "IconButton", flow: "", children: [] }
        ]
      },
      { ref: "c", name: "", type: "TextBlock", flow: "", children: [] }
    ]
  }
]

describe("LayoutTree", () => {
  it("点一段：把这段连同下面的段里的控件交出去；再点一下取消", () => {
    const picked = vi.fn()
    render(<LayoutTree nodes={NODES} controls={CONTROLS} onPick={picked} />)

    // 容器那一行显示的是方向（层名在悬停提示里）：点它就是点这一段。
    fireEvent.click(screen.getByText("竖排"))
    expect(picked).toHaveBeenLastCalledWith(["a", "b"])

    fireEvent.click(screen.getByText("竖排"))
    expect(picked).toHaveBeenLastCalledWith([])
  })

  it("一段自己放着的号显示在它那一行上", () => {
    render(<LayoutTree nodes={NODES} controls={CONTROLS} onPick={() => undefined} />)
    expect(screen.getByText("IconButton · #1")).toBeTruthy()
    expect(screen.getByText("TextBlock · #3")).toBeTruthy()
    // 容器只说方向（设计稿的自动布局），不显示「容器 194」这种层名；层名在悬停提示里。
    expect(screen.getByText("竖排")).toBeTruthy()
    expect(screen.getByText("自由布局")).toBeTruthy()
    expect(screen.getByTitle("RightTools（bar）")).toBeTruthy()
  })

  it("没有层次图时这一块不出现", () => {
    const { container } = render(<LayoutTree nodes={[]} controls={CONTROLS} onPick={() => undefined} />)
    expect(container.textContent).toBe("")
  })
})
