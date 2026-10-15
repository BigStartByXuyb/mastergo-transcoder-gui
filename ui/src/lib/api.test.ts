import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiFailure, api } from "@/lib/api"

function stubFetch(handler: (url: string) => Promise<Response> | Response) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => Promise.resolve(handler(String(input))))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("api 的失败映射", () => {
  it("连不上服务时报 OFFLINE，并带上原始错误", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")))
    await expect(api.health()).rejects.toMatchObject({ code: "OFFLINE", message: "连不上本地服务" })
  })

  it("返回非 JSON 时报 BAD_RESPONSE，并把片段放进 hint", async () => {
    stubFetch(() => new Response("<html>oops</html>", { status: 200 }))
    await expect(api.health()).rejects.toMatchObject({ code: "BAD_RESPONSE" })
  })

  it("HTTP 错误按后端给的 code/hint 透出", async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { code: "NO_PROJECT", message: "请先填工程目录", hint: "必填" } }), { status: 400 }))
    const failure = await api.health().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiFailure)
    expect(failure).toMatchObject({ code: "NO_PROJECT", message: "请先填工程目录", hint: "必填" })
  })

  it("没有 error 字段时退回 HTTP_<状态码>", async () => {
    stubFetch(() => new Response("", { status: 502 }))
    await expect(api.health()).rejects.toMatchObject({ code: "HTTP_502" })
  })

  it("成功时返回解析后的 JSON", async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: true, version: "9.9.9", plugin: {}, frames: [] }), { status: 200 }))
    await expect(api.health()).resolves.toMatchObject({ ok: true, version: "9.9.9" })
  })
})
