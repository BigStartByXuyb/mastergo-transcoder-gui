import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsUpdatePanel } from "@/app/settings-update-panel"

/*
 * 更新页里的两段切换：客户端与插件（流水线）。
 * 走真的 api 层（只把 fetch 换掉）：各接口给个空壳返回，验的是「切哪一段、显示哪一段」。
 */

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, status: {}, sources: [] }), { status: 200 })))
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SettingsUpdatePanel", () => {
  it("两段切换：点插件那一段交回 plugin，按 part 渲染对应内容", () => {
    stub()
    const onPickPart = vi.fn()
    const { unmount } = render(<SettingsUpdatePanel part="" onPickPart={onPickPart} />)

    expect(screen.getByRole("tab", { name: /客户端/ }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText("程序更新")).toBeTruthy()

    fireEvent.click(screen.getByRole("tab", { name: /插件（流水线）/ }))
    expect(onPickPart).toHaveBeenCalledWith("plugin")
    unmount()

    render(<SettingsUpdatePanel part="plugin" onPickPart={onPickPart} />)
    expect(screen.getByRole("tab", { name: /插件（流水线）/ }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText("插件")).toBeTruthy()
    expect(screen.queryByText("程序更新")).toBeNull()
  })
})
