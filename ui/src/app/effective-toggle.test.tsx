import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { EffectiveToggle } from "@/app/effective-toggle"

function show(props: { checked: boolean; hidden: number; onChange?: (value: boolean) => void }) {
  render(
    <EffectiveToggle
      id="t-only-effective"
      checked={props.checked}
      hidden={props.hidden}
      onChange={props.onChange ?? (() => {})}
    />
  )
}

describe("EffectiveToggle", () => {
  it("没有藏起来的东西时不带括号说明", () => {
    show({ checked: true, hidden: 0 })
    expect(screen.getByText("只看生效")).toBeTruthy()
  })

  it("藏了几条就写几条，数字来自调用方", () => {
    show({ checked: true, hidden: 3 })
    expect(screen.getByText("只看生效（已藏起 3 条被覆盖的）")).toBeTruthy()
  })

  it("开关状态由外面给，点一下把新值交回去", () => {
    const onChange = vi.fn()
    show({ checked: true, hidden: 0, onChange })
    const control = screen.getByRole("switch")
    expect(control.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(control)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it("关掉时开关呈未选中，文案不变", () => {
    show({ checked: false, hidden: 2 })
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false")
    expect(screen.getByText("只看生效（已藏起 2 条被覆盖的）")).toBeTruthy()
  })
})
