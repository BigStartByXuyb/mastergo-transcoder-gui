import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { DesignImagePicker } from "@/app/design-image-picker"

/*
 * 选图框：手里拿着哪张图由调用方给，这里只报「选了哪一张 / 移除了」。
 * 后端判据（是不是 PNG·JPEG、太大）不在这里判 —— 这一条与 lib/design-image.js 同一口径。
 */

function show(file: File | null) {
  const onPick = vi.fn()
  const { container } = render(<DesignImagePicker id="pick" file={file} onPick={onPick} />)
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  return { onPick, input }
}

describe("DesignImagePicker", () => {
  it("选一张就把那一份文件交出去", () => {
    const { onPick, input } = show(null)
    const file = new File(["x"], "DemoPage.design.png", { type: "image/png" })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onPick).toHaveBeenCalledWith(file)
  })

  it("选好的那份照实显示，移除就交回空", () => {
    const file = new File(["x"], "DemoPage.design.png", { type: "image/png" })
    const { onPick } = show(file)
    expect(screen.getByText(/DemoPage\.design\.png/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /移除/ }))
    expect(onPick).toHaveBeenCalledWith(null)
  })

  it("没有图时不显示文件名", () => {
    show(null)
    expect(screen.queryByText(/移除/)).toBeNull()
  })
})
