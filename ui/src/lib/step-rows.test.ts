import { describe, expect, it } from "vitest"

import type { BoardTask, PipelineStep } from "@/lib/api"
import { stepRowOf, stepRowsOf } from "@/lib/step-rows"

/*
 * 步骤条的数据映射：契约给顺序与标题，运行登记表给状态、耗时与补输入记录。
 * 步骤条与步骤界面读同一份 —— 所以这一处的默认值与兜底写法就是它们的唯一口径。
 */

function step(id: number, name: string, title: string): PipelineStep {
  return { Id: id, Name: name, Title: title, Inputs: [], Outputs: [], Failures: [], Recovery: [] }
}

function run(over: Partial<BoardTask["steps"][number]> = {}): BoardTask["steps"][number] {
  return { id: 1, name: "fetch", status: "ok", seconds: 1.2, note: "候选 3 条", humanInput: false, aiFill: null, ...over }
}

const CONTRACT = [step(1, "fetch", "取数"), step(2, "ledger", "图标台账")]

describe("step-rows", () => {
  it("契约里的每一步各一行；没跑到的标「未开始」", () => {
    const rows = stepRowsOf(CONTRACT, [run()])

    expect(rows.map((row) => [row.id, row.name, row.status, row.seconds])).toEqual([
      [1, "fetch", "ok", 1.2],
      [2, "ledger", "pending", 0]
    ])
    expect(rows[1].title).toBe("图标台账")
    expect(rows[1].note).toBe("")
    expect(rows[1].humanInput).toBe(false)
  })

  it("AI 补输入记在消费它的那一步上，并标出当时停在第几步", () => {
    const rows = stepRowsOf(CONTRACT, [
      run(),
      run({ id: 2, name: "ledger", humanInput: true, aiFill: { at: "", stepName: "ledger", stepTitle: "图标台账", stoppedAt: "fetch", filled: ["MenuOk"] } })
    ])

    expect(rows[1].aiFill).toEqual(["MenuOk"])
    expect(rows[1].aiFillNote).toBe("（当时停在第 1 步）")
    // 停在同一步时不补那句话（不是「从别处补过来」的）。
    expect(stepRowsOf(CONTRACT, [run({ aiFill: { at: "", stepName: "fetch", stepTitle: "取数", stoppedAt: "fetch", filled: ["x"] } }), run({ id: 2, name: "ledger" })])[0].aiFillNote).toBe("")
  })

  it("某一步那一行：契约里有就用契约，契约里没有就用登记表造一条", () => {
    expect(stepRowOf(CONTRACT, [run()], "fetch")).toMatchObject({ id: 1, title: "取数", status: "ok" })

    const unknown = stepRowOf(CONTRACT, [run({ id: 7, name: "legacy", status: "failed" })], "legacy")
    expect(unknown).toMatchObject({ id: 7, name: "legacy", title: "legacy", status: "failed" })

    // 两边都没有（契约还没读到）：空白也不该出现，给一条「未开始」。
    expect(stepRowOf([], [], "anything")).toMatchObject({ id: 0, title: "anything", status: "pending" })
  })
})
