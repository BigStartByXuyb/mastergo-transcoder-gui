import { afterEach, describe, expect, it, vi } from "vitest"

import { preparePipelineAItems } from "@/app/prepare-pipeline-items"

const LINK = "https://mastergo.com/goto/x?file=1&layer_id=2:3"

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("preparePipelineAItems", () => {
  it("登记表已有这一页时直接沿用，不再取设计页名或写登记表", async () => {
    const urls: string[] = []
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      urls.push(url)
      bodies.push(body)
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "停止调整", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        return Promise.resolve(json({
          ok: true,
          candidates: [{ target: "F3StopAdjust", ui: "F3", basis: "", needsSemanticName: false }],
          ai: { used: false, items: [] },
          blocked: ""
        }))
      }
      if (url.includes("/api/identity/apply")) return Promise.resolve(json({ ok: true, replaced: false }))
      throw new Error("unexpected " + url)
    })

    const result = await preparePipelineAItems([{ link: LINK, target: "", mode: "A" }], "project")
    expect(result).toEqual({
      ok: true,
      items: [{ link: LINK, target: "F3StopAdjust", ui: "F3", mode: "A" }]
    })
    expect(bodies.filter((body) => "useAi" in body)).toEqual([
      expect.objectContaining({ useAi: false })
    ])
    expect(urls.some((url) => url.includes("/api/design/page-name"))).toBe(false)
    expect(urls.some((url) => url.includes("/api/identity/apply"))).toBe(false)
  })

  it("登记表给不出时让模型出语义名，直接采用可用候选", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "停止调整", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        if (body.useAi === false) {
          return Promise.resolve(json({ ok: true, candidates: [], ai: { used: false, items: [] }, blocked: "还没有区域" }))
        }
        return Promise.resolve(json({
          ok: true,
          candidates: [],
          ai: { used: true, items: [{ target: "F3StopAdjust", ui: "F3", basis: "模型", needsSemanticName: false }] },
          blocked: "还没有区域"
        }))
      }
      if (url.includes("/api/identity/apply")) return Promise.resolve(json({ ok: true, replaced: false }))
      throw new Error("unexpected " + url)
    })

    await expect(preparePipelineAItems([{ link: LINK, target: "", mode: "A" }], "project")).resolves.toEqual({
      ok: true,
      items: [{ link: LINK, target: "F3StopAdjust", ui: "F3", mode: "A" }]
    })
  })

  it("机械与模型都给不出身份时整批停在启动前", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        return Promise.resolve(json({ ok: true, candidates: [], ai: { used: false, items: [] }, blocked: "这一页还没登记区域" }))
      }
      throw new Error("unexpected " + url)
    })

    await expect(preparePipelineAItems([{ link: LINK, target: "", mode: "A" }], "project")).resolves.toEqual({
      ok: false,
      reason: "这一页还没登记区域"
    })
  })
})
