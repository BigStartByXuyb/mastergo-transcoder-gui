import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DesignImagePicker } from "@/app/design-image-picker"

/*
 * 选图框：手里拿着哪张图由调用方给，这里只报「选了哪一张 / 移除了」。
 * 选好之后磁贴里是本地预览（缩略图）；预览地址是浏览器给的，测试环境没有它，这里按浏览器那样给两个假的。
 * 后端判据（是不是 PNG·JPEG、太大）不在这里判 —— 这一条与 lib/design-image.js 同一口径。
 */

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: () => undefined }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function show(file: File | null) {
  const onPick = vi.fn()
  const { container } = render(<DesignImagePicker id="pick" file={file} onPick={onPick} />)
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  return { onPick, input, container }
}

describe("DesignImagePicker", () => {
  it("选一张就把那一份文件交出去", () => {
    const { onPick, input } = show(null)
    const file = new File(["x"], "DemoPage.design.png", { type: "image/png" })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onPick).toHaveBeenCalledWith(file)
    // 选完就把 value 清掉：不清的话再选同一份文件不会再触发 change。
    expect(input.value).toBe("")
  })

  it("选好的那份照实显示，移除就交回空", () => {
    const file = new File(["x"], "DemoPage.design.png", { type: "image/png" })
    const { container, onPick } = show(file)
    expect(screen.getByText(/DemoPage\.design\.png/)).toBeTruthy()
    // 只验「有缩略图」这件事：地址怎么来的（对象地址 / data URL）是实现选择，用例不钉它。
    const preview = container.querySelector("img")
    expect(preview).toBeTruthy()
    expect(preview?.getAttribute("src")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /移除/ }))
    expect(onPick).toHaveBeenCalledWith(null)
  })

  it("没有图时是那个加号：不显示文件名、也没有预览", () => {
    const { container } = show(null)
    expect(screen.queryByText(/移除/)).toBeNull()
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("点加号选一张")).toBeTruthy()
  })

  it("调用方可以不要那句提示（多行时重复着太吵）", () => {
    const onPick = vi.fn()
    render(<DesignImagePicker id="pick" file={null} emptyHint="" onPick={onPick} />)
    expect(screen.queryByText("点加号选一张")).toBeNull()
  })
})
