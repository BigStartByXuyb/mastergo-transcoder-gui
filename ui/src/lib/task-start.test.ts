import { describe, expect, it } from "vitest"

import type { IdentityCandidate } from "@/lib/api"
import { drive } from "@/lib/settings-fixtures"
import { canStartAll, decideStartIdentity } from "@/lib/task-start"

/*
 * 开始前的身份决定：缺身份时按自动化层级自动补一次。
 * 自动补与写登记表都注入进来 —— 这里只验判据，不碰网络。
 */

function candidate(target: string, ui = "F4"): IdentityCandidate {
  return { target, ui, semanticName: target.replace(/^F\d+/, ""), basis: "登记表", needsSemanticName: false, registered: true }
}

function input(over: Partial<Parameters<typeof decideStartIdentity>[0]> = {}) {
  return {
    link: "https://mastergo.com/goto/x?file=1&layer_id=99:056200",
    // 夹具路径按段拼（settings-fixtures 的 drive）：源码里不出现机器专属的盘符写法。
    projectRoot: drive("D", "only_test"),
    target: "",
    ui: "",
    automation: "assist",
    autoPick: async () => null,
    autoApply: async () => ({ ok: true as const }),
    ...over
  }
}

describe("decideStartIdentity", () => {
  it("没填身份、自动化层级是「自动」：补一次并写登记表", async () => {
    const applied: IdentityCandidate[] = []
    const decision = await decideStartIdentity(
      input({
        target: "",
        ui: "",
        automation: "auto",
        autoPick: async () => candidate("F4FocusMaintain"),
        autoApply: async (item) => {
          applied.push(item)
          return { ok: true }
        }
      })
    )

    expect(decision).toEqual({ ok: true, target: "F4FocusMaintain", ui: "F4" })
    expect(applied.map((item) => item.target)).toEqual(["F4FocusMaintain"])
  })

  it("补不出来时不开始，也不盖掉那条实现自己写下的原因", async () => {
    const decision = await decideStartIdentity(input({ automation: "auto", autoPick: async () => null }))

    expect(decision).toEqual({ ok: false })
  })

  it("自动候选写登记表失败时停止启动，并带回失败原因", async () => {
    const decision = await decideStartIdentity(input({
      automation: "auto",
      autoPick: async () => candidate("F4FocusMaintain"),
      autoApply: async () => ({ ok: false, reason: "登记表写入失败" })
    }))

    expect(decision).toEqual({ ok: false, reason: "登记表写入失败" })
  })

})

describe("canStartAll", () => {
  it("只有延后启动的排队任务时，启动全部不可用", () => {
    expect(canStartAll([{ state: "queued", deferStart: true }])).toBe(false)
  })

  it("存在未被延后的排队任务时才允许启动全部", () => {
    expect(canStartAll([
      { state: "queued", deferStart: true },
      { state: "queued", deferStart: false }
    ])).toBe(true)
  })
})
