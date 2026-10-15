import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PixelLoader } from "@/app/pixel-loader"

function withMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {}
  }))
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("PixelLoader", () => {
  it("中文按字排开，英文与版本号整块留着", () => {
    withMotion(true)
    render(<PixelLoader text="请稍等，正在切到 v0.4.3" />)
    for (const char of ["请", "稍", "等", "，", "正", "在", "切", "到"]) {
      expect(screen.getByText(char)).toBeTruthy()
    }
    expect(screen.getByText("v0.4.3")).toBeTruthy()
  })

  it("指到一个字就把它顶下去，其余不动", () => {
    withMotion(false)
    vi.useFakeTimers()
    render(<PixelLoader text="正在读取" />)
    // 第一个字先顶上
    expect(screen.getByText("正").className).toContain("translate-y-[2px]")
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByText("在").className).toContain("translate-y-[2px]")
    expect(screen.getByText("正").className).not.toContain("translate-y-[2px]")
  })

  // 指到头要收手：手是第二个 svg，收起来就只剩狐狸那一个。
  it("指到最后一个字之后把手收起来", () => {
    withMotion(false)
    vi.useFakeTimers()
    const { container } = render(<PixelLoader text="读取" />)
    expect(container.querySelectorAll("svg")).toHaveLength(2)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(container.querySelectorAll("svg")).toHaveLength(2)
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(container.querySelectorAll("svg")).toHaveLength(1)
  })

  it("系统设了减少动态效果就不指，只静态显示", () => {
    withMotion(true)
    vi.useFakeTimers()
    const { container } = render(<PixelLoader text="正在读取" />)
    expect(container.querySelectorAll("svg")).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(container.querySelectorAll("svg")).toHaveLength(1)
    expect(screen.getByText("正").className).not.toContain("translate-y-[2px]")
  })
})
