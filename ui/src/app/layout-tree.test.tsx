import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { LayoutTree } from "@/app/layout-tree"
import type { LayoutTreeNode } from "@/lib/api"

/*
 * 层次图：一段一段摆出来，点一段就把这段（连同它下面的段）里的控件交出去（画布据此描边）。
 * 「号按清单次序」这条规则不在这个组件里（后端按同一份清单算好，见 lib/layout-groups.js）。
 */

const NODES: LayoutTreeNode[] = [
  {
    ref: "root",
    name: "",
    type: "FRAME",
    numbers: [],
    children: [
      {
        ref: "bar",
        name: "RightTools",
        type: "FRAME",
        numbers: [],
        children: [
          { ref: "a", name: "", type: "IconButton", numbers: [1], children: [] },
          { ref: "b", name: "", type: "IconButton", numbers: [2], children: [] }
        ]
      },
      { ref: "c", name: "", type: "TextBlock", numbers: [3], children: [] }
    ]
  }
]

describe("LayoutTree", () => {
  it("点一段：把这段连同下面的段里的控件交出去；再点一下取消", () => {
    const picked = vi.fn()
    render(<LayoutTree nodes={NODES} onPick={picked} />)

    fireEvent.click(screen.getByText("RightTools"))
    expect(picked).toHaveBeenLastCalledWith(["a", "b"])

    fireEvent.click(screen.getByText("RightTools"))
    expect(picked).toHaveBeenLastCalledWith([])
  })

  it("一段自己放着的号显示在它那一行上", () => {
    render(<LayoutTree nodes={NODES} onPick={() => undefined} />)
    expect(screen.getByText("IconButton · #1")).toBeTruthy()
    expect(screen.getByText("TextBlock · #3")).toBeTruthy()
    // 容器自己没控件：只显示名字，不编一个号。
    expect(screen.getByText("RightTools")).toBeTruthy()
  })

  it("没有层次图时这一块不出现", () => {
    const { container } = render(<LayoutTree nodes={[]} onPick={() => undefined} />)
    expect(container.textContent).toBe("")
  })
})
