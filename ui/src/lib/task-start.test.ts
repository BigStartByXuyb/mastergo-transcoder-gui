import { describe, expect, it, vi } from "vitest"

import type { IdentityCandidate } from "@/lib/api"
import { conflictReason, decideStartIdentity } from "@/lib/task-start"

/*
 * 开始前的身份决定：先与链接对账，再在缺身份时按自动化层级自动补一次。
 * 取候选 / 自动补 / 写登记表都注入进来 —— 这里只验顺序与判据，不碰网络。
 */

function candidate(target: string, ui = "F4"): IdentityCandidate {
  return { target, ui, semanticName: target.replace(/^F\d+/, ""), basis: "登记表", needsSemanticName: false }
}

function input(over: Partial<Parameters<typeof decideStartIdentity>[0]> = {}) {
  return {
    link: "https://mastergo.com/goto/x?file=1&layer_id=99:056200",
    projectRoot: "D:\\only_test",
    target: "",
    ui: "",
    automation: "assist",
    loadCandidates: async () => [candidate("F4FocusMaintain")],
    autoPick: async () => null,
    autoApply: async () => undefined,
    ...over
  }
}

describe("decideStartIdentity", () => {
  it("填的 Target 与链接不是同一页：不开始，并说清登记表里那一页是什么", async () => {
    const decision = await decideStartIdentity(input({ target: "saddas" }))

    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.reason).toBe(conflictReason(candidate("F4FocusMaintain"), "saddas"))
    if (!decision.ok) expect(decision.reason).toContain("F4FocusMaintain")
  })

  it("填的 Target 就是链接指向那一页：直接用填的，不自动补", async () => {
    const autoPick = vi.fn(async () => candidate("F4FocusMaintain"))
    const decision = await decideStartIdentity(input({ target: "F4FocusMaintain", ui: "F4", automation: "auto", autoPick }))

    expect(decision).toEqual({ ok: true, target: "F4FocusMaintain", ui: "F4" })
    expect(autoPick).not.toHaveBeenCalled()
  })

  it("没填身份、自动化层级是「自动」：补一次并写登记表", async () => {
    const applied: IdentityCandidate[] = []
    const decision = await decideStartIdentity(
      input({ target: "", ui: "", automation: "auto", autoPick: async () => candidate("F4FocusMaintain"), autoApply: async (item) => void applied.push(item) })
    )

    expect(decision).toEqual({ ok: true, target: "F4FocusMaintain", ui: "F4" })
    expect(applied.map((item) => item.target)).toEqual(["F4FocusMaintain"])
  })

  it("补不出来时不开始，也不盖掉那条实现自己写下的原因", async () => {
    const decision = await decideStartIdentity(input({ automation: "auto", autoPick: async () => null }))

    expect(decision).toEqual({ ok: false })
  })
})
