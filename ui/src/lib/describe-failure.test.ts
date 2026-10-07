import { describe, expect, it } from "vitest"

import { ApiFailure } from "@/lib/api"
import { SERVICE_GONE_NOTE, describeFailure, serviceUpOn } from "@/lib/describe-failure"

describe("describeFailure", () => {
  it("后端错误把 hint 拼在后面：用户要知道怎么修", () => {
    expect(describeFailure(new ApiFailure("NEED_TARGET", "缺少页面 Target", "先填 Target 再跑"))).toBe(
      "缺少页面 Target：先填 Target 再跑"
    )
  })

  it("没有 hint 时只给消息，不留一个空冒号", () => {
    expect(describeFailure(new ApiFailure("NO_HINT", "插件目录不存在", ""))).toBe("插件目录不存在")
  })

  it("普通异常只给 message，不加 Error: 前缀", () => {
    expect(describeFailure(new Error("boom"))).toBe("boom")
    expect(describeFailure("直接抛的字符串")).toBe("直接抛的字符串")
  })

  it("请求断在半路＝后端已经没了：不报技术原文，只说去哪儿看", () => {
    expect(describeFailure(new ApiFailure("OFFLINE", "连不上本地服务", "Failed to fetch"))).toBe(SERVICE_GONE_NOTE)
  })
})

describe("serviceUpOn", () => {
  it("连不上（OFFLINE）＝后端已经不在；别的异常＝它答了话，还在", () => {
    expect(serviceUpOn(new ApiFailure("OFFLINE", "连不上本地服务", "Failed to fetch"))).toBe(false)
    expect(serviceUpOn(new ApiFailure("BUSY", "1 次流水线正在跑", "等它跑完再重启。"))).toBe(true)
    expect(serviceUpOn(new Error("boom"))).toBe(true)
  })
})
