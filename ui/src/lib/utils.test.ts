import { describe, expect, it } from "vitest"

import { cn } from "@/lib/utils"

describe("cn", () => {
  it("合并类名并去掉条件为假的项", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c")
  })
})
