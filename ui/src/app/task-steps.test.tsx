import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { StepRail, type StepRow } from "@/app/task-steps"

/*
 * 步骤条：每一步一行（序号 + 标题 + 状态 + 耗时 + 人/AI 语义输入），停在哪一步标「停这里」，
 * 点一步就把详情切到那一步。它不推「跑到哪一步了」——状态取自运行登记表（由调用方给）。
 */

function row(over: Partial<StepRow> = {}): StepRow {
  return {
    id: 1,
    name: "fetch",
    title: "取数",
    status: "pending",
    seconds: 0,
    humanInput: false,
    aiFill: [],
    aiFillNote: "",
    note: "",
    ...over
  }
}

const ROWS: StepRow[] = [
  row({ id: 1, name: "fetch", title: "取数", status: "ok", seconds: 1.2 }),
  row({ id: 2, name: "ledger", title: "图标台账", status: "failed" }),
  row({ id: 3, name: "layout", title: "Layout 清单", status: "running", humanInput: true })
]

describe("StepRail", () => {
  it("每一步都列出来，状态与耗时照实渲染", () => {
    render(<StepRail rows={ROWS} current="" stopStep="ledger" onPick={() => undefined} onPickOverview={() => undefined} />)

    expect(screen.getByText("取数")).toBeTruthy()
    expect(screen.getByText("图标台账")).toBeTruthy()
    expect(screen.getByText("Layout 清单")).toBeTruthy()
    expect(screen.getByText("完成")).toBeTruthy()
    expect(screen.getByText("失败")).toBeTruthy()
    expect(screen.getByText("运行中")).toBeTruthy()
    expect(screen.getByText("1.2s")).toBeTruthy()
    expect(screen.getByText("人/AI 语义输入")).toBeTruthy()
  })

  it("停在哪一步标「停这里」（失败的停点用红色徽章）", () => {
    const { unmount } = render(
      <StepRail rows={ROWS} current="" stopStep="ledger" onPick={() => undefined} onPickOverview={() => undefined} />
    )
    expect(screen.getAllByText("停这里").length).toBe(1)
    unmount()

    render(<StepRail rows={ROWS} current="" stopStep="layout" onPick={() => undefined} onPickOverview={() => undefined} />)
    expect(screen.getAllByText("停这里").length).toBe(1)
  })

  it("点一步切到那一步，点「任务总览」回总览", () => {
    const onPick = vi.fn()
    const onOverview = vi.fn()
    render(<StepRail rows={ROWS} current="fetch" stopStep="" onPick={onPick} onPickOverview={onOverview} />)

    fireEvent.click(screen.getByText("图标台账"))
    expect(onPick).toHaveBeenCalledWith("ledger")

    fireEvent.click(screen.getByText("任务总览"))
    expect(onOverview).toHaveBeenCalled()
  })
})
