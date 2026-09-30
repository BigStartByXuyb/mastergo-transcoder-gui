import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ConfirmSwitchDialog } from "@/app/confirm-switch-dialog"

function show(patch: Partial<Parameters<typeof ConfirmSwitchDialog>[0]> = {}) {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <ConfirmSwitchDialog
      target="0.6.20"
      current="0.6.21"
      freshRunRequired={true}
      busy=""
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...patch}
    />
  )
  return { onCancel, onConfirm }
}

describe("ConfirmSwitchDialog", () => {
  it("回退要说明会丢掉新版功能", () => {
    show()
    expect(screen.getByText("切到 v0.6.20？")).toBeTruthy()
    expect(screen.getByText(/回退到旧版/)).toBeTruthy()
  })

  it("升级时不提回退那句", () => {
    show({ target: "0.6.22", current: "0.6.21" })
    expect(screen.queryByText(/回退到旧版/)).toBeNull()
    expect(screen.getByText(/升级/)).toBeTruthy()
  })

  it("这一版要求新开一次运行就说清楚", () => {
    show({ freshRunRequired: true })
    expect(screen.getByText(/要求新开一次运行/)).toBeTruthy()
  })

  it("不知道要不要新开运行就不提这一条", () => {
    show({ freshRunRequired: null })
    expect(screen.queryByText(/要求新开一次运行/)).toBeNull()
  })

  it("有任务在跑时说明原因并挡住确认", () => {
    show({ busy: "1 次流水线正在跑" })
    expect(screen.getByText(/现在有任务在跑/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "切过去" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("确认与取消各自回调", () => {
    const { onCancel, onConfirm } = show({ busy: "" })
    fireEvent.click(screen.getByRole("button", { name: "切过去" }))
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(onConfirm).toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })
})
