import { describe, expect, it } from "vitest"

import { ApiFailure } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

describe("describeFailure", () => {
  it("后端错误把 hint 拼在后面：用户要知道怎么修", () => {
    expect(describeFailure(new ApiFailure("NEED_TARGET", "缺少页面 Target", "先填 Target 再跑"))).toBe(
      "缺少页面 Target：先填 Target 再跑"
    )
  })

  it("没有 hint 时只给消息，不留一个空冒号", () => {
    expect(describeFailure(new ApiFailure("NO_HINT", "插件目录不存在", ""))).toBe("插件目录不存在")
  })

  it("非 ApiFailure 的异常原文照给", () => {
    expect(describeFailure(new Error("boom"))).toBe("Error: boom")
    expect(describeFailure("直接抛的字符串")).toBe("直接抛的字符串")
  })
})
