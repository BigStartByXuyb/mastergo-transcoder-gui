import { afterEach, describe, expect, it, vi } from "vitest"

import { preparePipelineAItems } from "@/app/prepare-pipeline-items"
import { applyIdentities } from "@/lib/identity-flow"

const LINK = "https://mastergo.com/goto/x?file=1&layer_id=2:3"
const OTHER_LINK = "https://mastergo.com/goto/y?file=1&layer_id=4:5"

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("preparePipelineAItems", () => {
  it("登记表已有这一页时仍走同一套页名、候选与写回流程", async () => {
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

    const result = await preparePipelineAItems([{ link: LINK, target: "", mode: "A" }], "project", { automation: "auto" })
    expect(result).toMatchObject({
      ok: true,
      items: [{ link: LINK, target: "F3StopAdjust", ui: "F3", mode: "A" }],
      defaults: { ui: "", autoMerge: true, overwrite: true, stopAfter: "" }
    })
    if (!result.ok) throw new Error(result.reason)
    expect(urls.some((url) => url.includes("/api/identity/apply"))).toBe(false)
    await applyIdentities(result.identities)
    expect(bodies.filter((body) => "useAi" in body)).toEqual([
      expect.objectContaining({ useAi: false, autoAdopt: true })
    ])
    expect(urls.some((url) => url.includes("/api/design/page-name"))).toBe(true)
    expect(urls.some((url) => url.includes("/api/identity/apply"))).toBe(true)
    expect(bodies[bodies.length - 1]).toEqual(expect.objectContaining({
      entries: [expect.objectContaining({ designPageName: "停止调整" })]
    }))
  })

  it("登记表给不出时让模型出语义名，直接采用可用候选", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "停止调整", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        if (body.useAi === false) {
          return Promise.resolve(json({ ok: true, candidates: [], ai: { used: false, items: [] }, blocked: "" }))
        }
        return Promise.resolve(json({
          ok: true,
          candidates: [],
          ai: { used: true, items: [{ target: "F3StopAdjust", ui: "F3", basis: "模型", needsSemanticName: false }] },
          blocked: ""
        }))
      }
      if (url.includes("/api/identity/apply")) return Promise.resolve(json({ ok: true, replaced: false }))
      throw new Error("unexpected " + url)
    })

    const result = await preparePipelineAItems([{ link: LINK, target: "", mode: "A" }], "project", { automation: "auto" })
    expect(result).toMatchObject({
      ok: true,
      items: [{ link: LINK, target: "F3StopAdjust", ui: "F3", mode: "A" }],
      defaults: { ui: "", autoMerge: true, overwrite: true, stopAfter: "" }
    })
    if (!result.ok) throw new Error(result.reason)
    await applyIdentities(result.identities)
  })

  it("机械候选不给身份且后端未放行时整批停在启动前", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        return Promise.resolve(json({ ok: true, candidates: [], ai: { used: false, items: [] }, blocked: "这一页还没登记区域" }))
      }
      throw new Error("unexpected " + url)
    })

    await expect(preparePipelineAItems([{ link: LINK, target: "", mode: "A" }], "project", { automation: "auto" })).resolves.toEqual({
      ok: false,
      reason: "这一页还没登记区域"
    })
  })

  it("后一行准备失败时前一行也不提前写身份登记表", async () => {
    const urls: string[] = []
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      urls.push(url)
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "页面", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        if (body.link === OTHER_LINK) {
          return Promise.resolve(json({ ok: true, candidates: [], ai: { used: false, items: [] }, blocked: "第二行没有区域" }))
        }
        return Promise.resolve(json({
          ok: true,
          candidates: [{ target: "F3First", ui: "F3", basis: "", needsSemanticName: false }],
          ai: { used: false, items: [] },
          blocked: ""
        }))
      }
      if (url.includes("/api/identity/apply")) throw new Error("整批准备完成前不得写回")
      throw new Error("unexpected " + url)
    })

    await expect(preparePipelineAItems([
      { link: LINK, target: "", mode: "A" },
      { link: OTHER_LINK, target: "", mode: "A" }
    ], "project", { automation: "assist" })).resolves.toEqual({ ok: false, reason: "第二行没有区域" })
    expect(urls.some((url) => url.includes("/api/identity/apply"))).toBe(false)
  })

  it("后端 blocked 时即使 AI 给出候选也不采用", async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      bodies.push(body)
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "停止调整", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        return Promise.resolve(json({
          ok: true,
          candidates: [],
          ai: { used: true, items: [{ target: "F3StopAdjust", ui: "F3", basis: "模型", needsSemanticName: false }] },
          blocked: "设计页改过名，需要人工确认"
        }))
      }
      if (url.includes("/api/identity/apply")) throw new Error("blocked 时不得写回")
      throw new Error("unexpected " + url)
    })

    await expect(preparePipelineAItems([{ link: LINK, target: "", mode: "A" }], "project", { automation: "auto" })).resolves.toEqual({
      ok: false,
      reason: "设计页改过名，需要人工确认"
    })
    expect(bodies.some((body) => body.useAi === true)).toBe(false)
  })

  it("自动化关闭时身份准备也不调用模型", async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      bodies.push(body)
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "停止调整", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        return Promise.resolve(json({ ok: true, candidates: [], ai: { used: false, items: [] }, blocked: "" }))
      }
      throw new Error("unexpected " + url)
    })

    const result = await preparePipelineAItems([{ link: LINK, target: "", mode: "A" }], "project", { automation: "off" })
    expect(result.ok).toBe(false)
    expect(bodies.some((body) => body.useAi === true)).toBe(false)
  })

  it("辅助层级不会把模型候选直接写进 A 的身份登记表", async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      bodies.push(body)
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "停止调整", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        return Promise.resolve(json({ ok: true, candidates: [], ai: { used: false, items: [] }, blocked: "" }))
      }
      throw new Error("unexpected " + url)
    })

    const result = await preparePipelineAItems([{ link: LINK, target: "", mode: "A" }], "project", { automation: "assist" })
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: expect.stringMatching(/切到「自动」后重试/)
    }))
    expect(bodies.some((body) => body.useAi === true)).toBe(false)
  })

  it("A 行手写的 Target 优先，并按后端前缀规则补区域", async () => {
    const urls: string[] = []
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      urls.push(url)
      const body = init?.body
        ? JSON.parse(String(init.body)) as Record<string, unknown>
        : {}
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
      if (url.includes("/api/identity/prefix")) {
        return Promise.resolve(json({
          ok: true,
          previewUi: "F3",
          semanticName: "HandWritten",
          complete: true
        }))
      }
      if (url.includes("/api/identity/apply")) return Promise.resolve(json({ ok: true, replaced: false }))
      throw new Error("unexpected " + url)
    })
    const result = await preparePipelineAItems(
      [{ link: LINK, target: "F3HandWritten", mode: "A" }],
      "project",
      { automation: "auto" }
    )
    expect(result).toMatchObject({
      ok: true,
      items: [{ link: LINK, target: "F3HandWritten", ui: "F3", mode: "A" }]
    })
    expect(urls.some((url) => url.includes("/api/identity/prefix"))).toBe(true)
    expect(bodies.some((body) => body.useAi === true)).toBe(false)
  })

  it("A 行手写的 Target 与链接已登记页面冲突时停在启动前", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "停止调整", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        return Promise.resolve(json({
          ok: true,
          candidates: [{
            target: "F4Registered",
            ui: "F4",
            basis: "登记表",
            needsSemanticName: false,
            registered: true
          }],
          ai: { used: false, items: [] },
          blocked: ""
        }))
      }
      if (url.includes("/api/identity/prefix")) throw new Error("冲突应在取前缀前拦下")
      throw new Error("unexpected " + url)
    })

    await expect(preparePipelineAItems(
      [{ link: LINK, target: "F3HandWritten", mode: "A" }],
      "project",
      { automation: "auto" }
    )).resolves.toEqual({
      ok: false,
      reason: expect.stringMatching(/F4Registered/)
    })
  })

  it("同一条只有区域前缀的候选不能被手写 Target 绕过", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "停止调整", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        return Promise.resolve(json({
          ok: true,
          candidates: [{ target: "F3", ui: "F3", basis: "区域", needsSemanticName: true }],
          ai: { used: false, items: [] },
          blocked: ""
        }))
      }
      if (url.includes("/api/identity/prefix")) throw new Error("已知候选的完整性不应绕过同一采用判据")
      throw new Error("unexpected " + url)
    })

    const result = await preparePipelineAItems(
      [{ link: LINK, target: "F3", mode: "A" }],
      "project",
      { automation: "auto" }
    )
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("语义名要由人给")
    })
  })

  it("手写 Target 只有区域时按后端完整性结论停在启动前", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/design/page-name")) return Promise.resolve(json({ ok: true, pageName: "停止调整", rootId: "1:1" }))
      if (url.includes("/api/identity/candidates")) {
        return Promise.resolve(json({
          ok: true,
          candidates: [],
          ai: { used: false, items: [] },
          blocked: ""
        }))
      }
      if (url.includes("/api/identity/prefix")) {
        return Promise.resolve(json({
          ok: true,
          previewUi: "F3",
          semanticName: "",
          complete: false
        }))
      }
      throw new Error("unexpected " + url)
    })

    const result = await preparePipelineAItems(
      [{ link: LINK, target: "F3", mode: "A" }],
      "project",
      { automation: "auto" }
    )
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining("语义名要由人给")
    })
  })
})
