import { describe, expect, it } from "vitest"

import type { IdentityCandidate } from "@/lib/api"
import { pickIdentityCandidate } from "@/lib/identity-pick"

function candidate(patch: Partial<IdentityCandidate>): IdentityCandidate {
  return { target: "", ui: "", semanticName: "", basis: "", needsSemanticName: false, ...patch }
}

describe("pickIdentityCandidate", () => {
  it("区域唯一时采用第一条拼好的 Target", () => {
    const decision = pickIdentityCandidate(
      [candidate({ target: "F1StopAdjust", ui: "F1" }), candidate({ target: "F2StopAdjust", ui: "F2" })],
      false
    )
    expect(decision.pick?.target).toBe("F1StopAdjust")
    expect(decision.reason).toBe("")
  })

  it("优先采用不需要补语义名的那条", () => {
    const decision = pickIdentityCandidate(
      [
        candidate({ target: "F1NeedsName", ui: "F1", needsSemanticName: true }),
        candidate({ target: "F1StopAdjust", ui: "F1" })
      ],
      false
    )
    expect(decision.pick?.target).toBe("F1StopAdjust")
  })

  it("区域不唯一时必须让人点一次，不给候选结论", () => {
    const decision = pickIdentityCandidate([candidate({ target: "F1StopAdjust", ui: "F1" })], true)
    expect(decision.pick).toBeNull()
    expect(decision.reason).toContain("区域不是恰好一个")
  })

  it("候选为空时提示这是「项目第一次没有区域约定」，并说清人要给什么", () => {
    const decision = pickIdentityCandidate([], false)
    expect(decision.pick).toBeNull()
    expect(decision.reason).toContain("还没有任何区域约定")
    expect(decision.reason).toContain("docs/page-registry.json")
  })

  it("有候选但都缺语义名时，提示先补语义名", () => {
    const decision = pickIdentityCandidate([candidate({ ui: "F1", needsSemanticName: true })], false)
    expect(decision.pick).toBeNull()
    expect(decision.reason).toContain("先给语义名")
  })
})
