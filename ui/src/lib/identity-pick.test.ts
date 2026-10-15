import { describe, expect, it } from "vitest"

import type { IdentityCandidate } from "@/lib/api"
import { pickIdentityCandidate } from "@/lib/identity-pick"

function candidate(patch: Partial<IdentityCandidate>): IdentityCandidate {
  return { target: "", ui: "", semanticName: "", basis: "", needsSemanticName: false, ...patch }
}

describe("pickIdentityCandidate", () => {
  it("后端没挡住时采用第一条拼好的 Target", () => {
    const decision = pickIdentityCandidate(
      [
        candidate({ target: "F1StopAdjust", ui: "F1", registered: true }),
        candidate({ target: "F2StopAdjust", ui: "F2" })
      ],
      ""
    )
    expect(decision.pick?.target).toBe("F1StopAdjust")
    expect(decision.reason).toBe("")
  })

  it("跳过还要补语义名的那条，采用拼好的 Target", () => {
    const decision = pickIdentityCandidate(
      [
        candidate({ target: "F1", ui: "F1", needsSemanticName: true }),
        candidate({ target: "F1StopAdjust", ui: "F1" })
      ],
      ""
    )
    expect(decision.pick?.target).toBe("F1StopAdjust")
  })

  it("后端挡住时不许自动采用，原因原样交出去", () => {
    const blocked = "这一页（layerId 357:269592）还没登记过区域：……"
    const decision = pickIdentityCandidate([candidate({ target: "F1StopAdjust", ui: "F1" })], blocked)
    expect(decision.pick).toBeNull()
    expect(decision.reason).toBe(blocked)
  })

  it("后端放行但候选里没有拼好的 Target 时，说清语义名要由人给", () => {
    const decision = pickIdentityCandidate([candidate({ ui: "F1", needsSemanticName: true })], "")
    expect(decision.pick).toBeNull()
    expect(decision.reason).toContain("语义名要由人给")
    expect(decision.reason).toContain("F1StopAdjust")
  })
})
