import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StepFlow } from "@/app/task-steps"
import type { BoardTask } from "@/lib/api"

function task(steps: BoardTask["steps"]): BoardTask {
  return {
    id: "t1",
    createdAt: "",
    updatedAt: "",
    state: "running",
    stateLabel: "运行中",
    request: {
      mode: "B",
      link: "",
      target: "F3Align",
      ui: "F3",
      projectRoot: "",
      fileId: "",
      layerId: "",
      stopAfter: "",
      overwrite: false
    },
    jobId: "job-1",
    workDir: "",
    autoMerge: true,
    progress: null,
    steps,
    aiFills: [],
    failure: null,
    merge: null,
    error: ""
  }
}

const titles = new Map([
  ["discover", "图标候选发现"],
  ["ledger", "图标台账"]
])

describe("StepFlow", () => {
  it("还没跑到第一步时给出说明而不是空白", () => {
    render(<StepFlow task={task([])} stepTitles={titles} />)
    expect(screen.getByText(/还没有步骤登记/)).toBeTruthy()
  })

  it("用契约里的标题渲染每一步，并标出状态与耗时", () => {
    render(
      <StepFlow
        task={task([
          { id: 6, name: "discover", status: "ok", seconds: 1.2, note: "候选 3 条", humanInput: false, aiFill: null },
          { id: 7, name: "ledger", status: "running", seconds: 0, note: "", humanInput: true, aiFill: null }
        ])}
        stepTitles={titles}
      />
    )
    expect(screen.getByText("图标候选发现")).toBeTruthy()
    expect(screen.getByText("图标台账")).toBeTruthy()
    expect(screen.getByText("完成")).toBeTruthy()
    expect(screen.getByText("运行中")).toBeTruthy()
    expect(screen.getByText("1.2s")).toBeTruthy()
    expect(screen.getByText("候选 3 条")).toBeTruthy()
    expect(screen.getByText("人/AI 语义输入")).toBeTruthy()
  })

  it("AI 补输入的记录画在消费它的那一步之前，并标出当时停在第几步", () => {
    render(
      <StepFlow
        task={task([
          { id: 6, name: "discover", status: "ok", seconds: 0, note: "", humanInput: false, aiFill: null },
          {
            id: 7,
            name: "ledger",
            status: "ok",
            seconds: 0,
            note: "",
            humanInput: true,
            aiFill: { at: "", stepName: "ledger", stepTitle: "图标台账", stoppedAt: "discover", filled: ["MenuOk"] }
          }
        ])}
        stepTitles={titles}
      />
    )
    expect(screen.getByText("AI 补输入")).toBeTruthy()
    expect(screen.getByText("MenuOk")).toBeTruthy()
    expect(screen.getByText("（当时停在第 6 步）")).toBeTruthy()
  })

  it("契约里没有标题时退回步骤名", () => {
    render(<StepFlow task={task([{ id: 1, name: "fetch", status: "pending", seconds: 0, note: "", humanInput: false, aiFill: null }])} stepTitles={new Map()} />)
    expect(screen.getByText("fetch")).toBeTruthy()
  })
})
