import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { BoardTaskTable } from "@/app/board-task-table"

/*
 * 空状态三种原因必须分开说：还没有任务 / 被筛选筛掉 / 被「只看生效」藏起来。
 * 尤其第三种不能指向「清除筛选」—— 那个按钮此时根本没渲染。
 */
function show(props: { filtered: boolean; hiddenByEffective: number; onCreate?: () => void }) {
  render(
    <BoardTaskTable
      tasks={[]}
      coverage={new Map()}
      busy=""
      onRun={async () => {}}
      onCreate={props.onCreate ?? (() => {})}
      filtered={props.filtered}
      hiddenByEffective={props.hiddenByEffective}
    />
  )
}

describe("BoardTaskTable 的空状态", () => {
  it("没有任务、也没筛：给「创建任务」", () => {
    const onCreate = vi.fn()
    show({ filtered: false, hiddenByEffective: 0, onCreate })
    expect(screen.getByText("还没有任务。")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }))
    expect(onCreate).toHaveBeenCalled()
  })

  it("筛没了：说清是筛选，并指向「清除筛选」", () => {
    show({ filtered: true, hiddenByEffective: 0 })
    expect(screen.getByText("当前筛选下没有任务。")).toBeTruthy()
    expect(screen.getByText(/清除筛选/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "创建任务" })).toBeNull()
  })

  it("被「只看生效」藏起来：不指向清除筛选，而是说清藏了几条", () => {
    show({ filtered: false, hiddenByEffective: 11 })
    expect(screen.getByText("任务都被「只看生效」藏起来了。")).toBeTruthy()
    expect(screen.getByText(/共 11 条已被后一次合并覆盖/)).toBeTruthy()
  })
})
