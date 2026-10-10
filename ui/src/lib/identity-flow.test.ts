import { afterEach, describe, expect, it, vi } from "vitest"

import { applyIdentity, candidatesForLink, identityConflict } from "@/lib/identity-flow"

/*
 * 走真的 api 层（只把 fetch 换掉）：要验的就是「拼了哪些字段出去、模型那几条排哪」，
 * 绕开 api 就测不到了。
 */

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

function stub(reply: () => Promise<Response>) {
  const mock = vi.fn(() => reply())
  vi.stubGlobal("fetch", mock)
  return mock
}

function sentBody(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = mock.mock.calls[0] as [string, RequestInit]
  return JSON.parse(String(call[1].body))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("candidatesForLink", () => {
  it("带上的字段就是后端要的那几个，两侧空白去掉", async () => {
    const mock = stub(() => ok({ ok: true, uiCandidates: [], candidates: [], ai: { used: false, items: [] }, blocked: "" }))
    await candidatesForLink({
      link: "  https://mastergo.com/goto/x?file=1&layer_id=2:3  ",
      projectRoot: "  /project  ",
      pageName: "  Stop Adjust ",
      ui: " F1 ",
      useAi: true
    })
    expect(sentBody(mock)).toEqual({
      projectRoot: "/project",
      pageName: "Stop Adjust",
      useAi: true,
      ui: "F1",
      link: "https://mastergo.com/goto/x?file=1&layer_id=2:3"
    })
  })

  it("模型给的候选排在前，后端挡住的原因原样带出", async () => {
    stub(() =>
      ok({
        ok: true,
        uiCandidates: [],
        candidates: [{ target: "F1Mechanical", ui: "F1", semanticName: "Mechanical", basis: "机械转换", needsSemanticName: false }],
        ai: { used: true, items: [{ target: "F1StopAdjust", ui: "F1", semanticName: "StopAdjust", basis: "模型", needsSemanticName: false }] },
        blocked: "没登记过"
      })
    )
    const got = await candidatesForLink({ link: "l", projectRoot: "p", pageName: "", ui: "", useAi: true })
    expect(got.items.map((item) => item.target)).toEqual(["F1StopAdjust", "F1Mechanical"])
    expect(got.blocked).toBe("没登记过")
  })
})

describe("applyIdentity", () => {
  it("页名沿用候选里记的那条，避免抹掉登记", async () => {
    const mock = stub(() => ok({ ok: true, replaced: true }))
    const written = await applyIdentity({
      link: "https://mastergo.com/goto/x?file=1&layer_id=2:3",
      projectRoot: "/project",
      pageName: "",
      item: { target: "F1StopAdjust", ui: "F1", semanticName: "StopAdjust", basis: "登记表", needsSemanticName: false, designPageName: "停止调整" }
    })
    expect(written.replaced).toBe(true)
    expect(sentBody(mock)).toEqual({
      projectRoot: "/project",
      target: "F1StopAdjust",
      ui: "F1",
      link: "https://mastergo.com/goto/x?file=1&layer_id=2:3",
      designPageName: "停止调整"
    })
  })

  it("人填了页名就以人填的为准", async () => {
    const mock = stub(() => ok({ ok: true, replaced: false }))
    await applyIdentity({
      link: "l",
      projectRoot: "p",
      pageName: "StopAdjust",
      item: { target: "F1StopAdjust", ui: "F1", semanticName: "", basis: "", needsSemanticName: false, designPageName: "旧的" }
    })
    expect(sentBody(mock).designPageName).toBe("StopAdjust")
  })
})

describe("identityConflict", () => {
  const registered = {
    target: "F4FocusMaintain",
    ui: "F4",
    semanticName: "FocusMaintain",
    basis: "登记表",
    needsSemanticName: false
  }

  it("填的 Target 就是链接指向的那一页：不拦", () => {
    expect(identityConflict({ target: "F4FocusMaintain", candidates: [registered] })).toBeNull()
  })

  it("填的 Target 与链接指向的那一页不一致：把链接那一页交出来（调用方据此拦下提交）", () => {
    // 真实回归：Target 拼错成 saddas，链接指向的 99:056200 在登记表里是 F4FocusMaintain。
    expect(identityConflict({ target: "saddas", candidates: [registered] })).toBe(registered)
  })

  it("没填 Target、或后端给不出候选：无从对账，不拦", () => {
    expect(identityConflict({ target: "", candidates: [registered] })).toBeNull()
    expect(identityConflict({ target: "Any", candidates: [] })).toBeNull()
  })
})
