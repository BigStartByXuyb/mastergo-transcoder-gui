import { describe, expect, it } from "vitest"

import { deriveUiPrefix } from "@/lib/ui-prefix"

describe("deriveUiPrefix", () => {
  it("Target 带编号前缀时取编号段", () => {
    expect(deriveUiPrefix("F3Align")).toBe("F3")
    expect(deriveUiPrefix("F2ManualAlign")).toBe("F2")
    expect(deriveUiPrefix("F3区域")).toBe("F3")
  })

  it("没有编号时取首个英文词（主页类不写 F0）", () => {
    expect(deriveUiPrefix("HomeContent")).toBe("Home")
    expect(deriveUiPrefix("Home")).toBe("Home")
    expect(deriveUiPrefix("HOME")).toBe("HOME")
  })

  it("推不出来就给空串，绝不凭空编一个 F", () => {
    expect(deriveUiPrefix("")).toBe("")
    expect(deriveUiPrefix("   ")).toBe("")
    expect(deriveUiPrefix("手动对准")).toBe("")
  })
})
