import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { IdentityFillPanel } from "@/app/identity-fill-panel"
import type { IdentityCandidate } from "@/lib/api"

/*
 * 这个面板收的是「当前输入 + 要画的状态 + 回调」，不依赖 hook，
 * 所以每条分支都能拿夹具直接画出来看。
 */

function actions() {
  return {
    onName: vi.fn(),
    onFill: vi.fn(),
    onApply: vi.fn(),
    onTakePageName: vi.fn(),
    onPick: vi.fn()
  }
}

function candidate(patch: Partial<IdentityCandidate> = {}): IdentityCandidate {
  return { target: "", ui: "", semanticName: "", basis: "", needsSemanticName: false, ...patch }
}

describe("IdentityFillPanel", () => {
  it("两个按钮都在，从链接取设计页名按「有没有链接」决定能不能点", () => {
    const onFill = vi.fn()
    const onTakePageName = vi.fn()
    render(
      <IdentityFillPanel
        inputs={{ link: "https://mastergo.com/goto/x", target: "", ui: "", automation: "assist" }}
        state={{ name: "", candidates: [], busy: "", derivedUi: "", pages: null }}
        actions={{ ...actions(), onFill, onTakePageName }}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /自动补 Target/ }))
    fireEvent.click(screen.getByRole("button", { name: /从链接取设计页名/ }))
    expect(onFill).toHaveBeenCalled()
    expect(onTakePageName).toHaveBeenCalled()
  })

  it("没有链接时取页名按钮点不动", () => {
    render(
      <IdentityFillPanel
        inputs={{ link: "", target: "", ui: "", automation: "assist" }}
        state={{ name: "", candidates: [], busy: "", derivedUi: "", pages: null }}
        actions={actions()}
      />
    )
    expect((screen.getByRole("button", { name: /从链接取设计页名/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("候选列出来，点一条就交出去；还缺语义名的那条点不动", () => {
    const onApply = vi.fn()
    render(
      <IdentityFillPanel
        inputs={{ link: "l", target: "", ui: "", automation: "assist" }}
        state={{
          name: "",
          candidates: [
            candidate({ target: "F1StopAdjust", ui: "F1", basis: "登记表里这一页已经登记过" }),
            candidate({ target: "F1", ui: "F1", needsSemanticName: true, basis: "机械转换" })
          ],
          busy: "",
          derivedUi: "",
          pages: null
        }}
        actions={{ ...actions(), onApply }}
      />
    )
    expect(screen.getByText(/登记表里这一页已经登记过/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "还缺语义名" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "F1StopAdjust" }))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ target: "F1StopAdjust" }))
  })

  it("UI 与 Target 都空时提醒插件会按取值链解析", () => {
    render(
      <IdentityFillPanel
        inputs={{ link: "l", target: "", ui: "", automation: "assist" }}
        state={{ name: "", candidates: [], busy: "", derivedUi: "", pages: null }}
        actions={actions()}
      />
    )
    expect(screen.getByText(/UI 与 Target 都空/)).toBeTruthy()
  })

  it("Target 推不出前缀时说清两种形状", () => {
    render(
      <IdentityFillPanel
        inputs={{ link: "l", target: "stop_adjust", ui: "", automation: "assist" }}
        state={{ name: "", candidates: [], busy: "", derivedUi: "", pages: null }}
        actions={actions()}
      />
    )
    expect(screen.getByText(/推不出区域前缀/)).toBeTruthy()
    expect(screen.getByText(/F3stop_adjust/)).toBeTruthy()
  })

  it("推得出区域时换成一句预览", () => {
    render(
      <IdentityFillPanel
        inputs={{ link: "l", target: "F3Align", ui: "", automation: "assist" }}
        state={{ name: "", candidates: [], busy: "", derivedUi: "F3", pages: null }}
        actions={actions()}
      />
    )
    expect(screen.getByText(/将使用 UI=F3/)).toBeTruthy()
  })

  it("自动层级下说明会写明会直接采用", () => {
    render(
      <IdentityFillPanel
        inputs={{ link: "l", target: "F3Align", ui: "F3", automation: "auto" }}
        state={{ name: "", candidates: [], busy: "", derivedUi: "", pages: null }}
        actions={actions()}
      />
    )
    expect(screen.getByText(/这一页登记过就自动沿用/)).toBeTruthy()
  })
})
