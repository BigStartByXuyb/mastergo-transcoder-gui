import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PendingPanel } from "@/app/pending-panel"
import type { Pending } from "@/lib/api"
import { drive } from "@/lib/settings-fixtures"

/*
 * 待确认面板：清单渲染与「确认并继续」的门禁。
 * 跑着的时候不给续跑这一条由 ui/src/lib/task-state.ts 的 isInFlight 统一判定；
 * 这里验这个入口真的按它拦住了、并把原因说出来。
 */

function pending(): Pending {
  return {
    projectRoot: drive("D", "work", "task-1"),
    target: "DemoPage",
    summary: null,
    icons: {
      available: true,
      candidatesPath: "",
      namingPath: "",
      registrationSummary: null,
      candidates: [],
      mustName: [{
        index: 1,
        sourceRef: "1:9",
        svgName: "",
        nodeName: "",
        status: "must-name",
        reason: "",
        ownerText: "确定",
        ownerControlType: "IconButton",
        parentType: "",
        siblingPathCount: 1,
        registration: { register: true, basis: "icon-policy-single-path", source: "" },
        ledgerFields: {},
        sourceIsPageRoot: false,
        filled: false
      }],
      missing: 1,
      stale: 0,
      staleIndexes: [],
      duplicates: [],
      naming: [],
      needsNaming: true,
      needsRepair: false,
      waiting: 1
    },
    translations: {
      available: true,
      translationsPath: "",
      glossaryPath: "",
      pendingTranslations: [],
      glossaryRequired: [],
      translations: {},
      glossary: {},
      needsTranslation: false,
      needsGlossary: false,
      waiting: 0
    },
    layout: {
      needsGroups: false,
      hasGroups: false,
      rejected: false,
      failed: false,
      failedMessage: "",
      waiting: 0
    }
  }
}

function stub() {
  return stubWith({})
}

/* AI 候选：手动按钮那条路要它回一份候选，验「候选按同一处口径落进输入框」。 */
function stubWith(options: {
  iconNames?: { index: number; name: string; comment: string }[]
  pending?: Pending
  aiReady?: boolean
  onConfirm?: (body: Record<string, unknown>) => void
}) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes("/api/settings")) {
      return Promise.resolve(
        new Response(JSON.stringify({
          ok: true,
          settings: {
            automation: "off",
            ai: {
              hasKey: options.aiReady === true,
              baseUrl: options.aiReady === true ? "https://ai.example" : "",
              model: options.aiReady === true ? "model" : ""
            }
          }
        }), { status: 200 })
      )
    }
    if (url.includes("/api/ai/suggest")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, items: options.iconNames ?? [{ index: 1, name: "MenuOk", comment: "候选" }] }), { status: 200 })
      )
    }
    if (url.includes("/api/confirm")) {
      options.onConfirm?.(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>)
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, written: [], job: null }), { status: 200 })
      )
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, pending: options.pending ?? pending() }), { status: 200 }))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function panel(state: string, overrides: Partial<Parameters<typeof PendingPanel>[0]> = {}) {
  return (
    <PendingPanel
      projectRoot={drive("D", "work", "task-1")}
      target="DemoPage"
      mode="A"
      taskId="task-1"
      runId="job-1"
      state={state}
      automation="off"
      {...overrides}
    />
  )
}

describe("PendingPanel", () => {
  it("手填条目自动补候选后只写文件，不伪造续跑", async () => {
    let confirmed: Record<string, unknown> | null = null
    stubWith({ aiReady: true, onConfirm: (body) => { confirmed = body } })
    render(panel("waiting", { automation: "auto", runId: "", taskId: "" }))
    await waitFor(() => expect(confirmed).not.toBeNull())
    expect(confirmed).toMatchObject({ resume: false, runId: "", taskId: "" })
  })

  it("跑着的时候不给续跑：按钮禁用，并把原因说出来", async () => {
    stub()
    render(panel("running"))

    const submit = await screen.findByRole("button", { name: /确认并继续/ })
    expect(submit.hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("button", { name: /只写入，不继续/ }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByText(/流水线正在跑：等它停下来再点「确认并继续」/)).toBeTruthy()
  })

  it("停在语义停点上（waiting）时照常给续跑", async () => {
    stub()
    render(panel("waiting"))

    const submit = await screen.findByRole("button", { name: /确认并继续/ })
    expect(submit.hasAttribute("disabled")).toBe(false)
    expect(screen.queryByText(/流水线正在跑/)).toBeNull()
  })

  it("只有任务 id、没有来源运行时只允许写文件，不承诺续跑", async () => {
    stub()
    render(panel("waiting", { runId: "" }))

    const submit = await screen.findByRole("button", { name: /确认并继续/ })
    expect(submit.hasAttribute("disabled")).toBe(true)
    expect(screen.getByText(/没有来源运行：可以写文件，不能自动续跑/)).toBeTruthy()
  })

  it("手动叫 AI 出候选：候选按同一处口径填进输入框", async () => {
    stubWith({ iconNames: [{ index: 1, name: "MenuOk", comment: "菜单项" }] })
    render(panel("waiting"))

    const ask = await screen.findByRole("button", { name: /让 AI 重新出候选名/ })
    ask.click()
    const input = await screen.findByDisplayValue("MenuOk")
    expect(input).toBeTruthy()
  })

  it("只剩布局停点时给出显式空表出口，提交载荷写 groups: []", async () => {
    const layoutPending = pending()
    layoutPending.icons.waiting = 0
    layoutPending.icons.missing = 0
    layoutPending.icons.needsNaming = false
    layoutPending.layout = {
      needsGroups: true,
      hasGroups: false,
      rejected: false,
      failed: false,
      failedMessage: "",
      waiting: 1
    }
    let confirmed: Record<string, unknown> | null = null
    stubWith({
      pending: layoutPending,
      onConfirm: (body) => {
        confirmed = body
      }
    })
    render(panel("waiting"))

    const empty = await screen.findByRole("button", { name: /按空表重写并继续/ })
    empty.click()
    await vi.waitFor(() => expect(confirmed).not.toBeNull())
    expect(confirmed).toEqual(expect.objectContaining({ groups: [] }))
  })

  it("主提交不替用户写空布局表", async () => {
    const layoutPending = pending()
    layoutPending.layout = {
      needsGroups: true,
      hasGroups: false,
      rejected: false,
      failed: false,
      failedMessage: "",
      waiting: 1
    }
    let confirmed: Record<string, unknown> | null = null
    stubWith({
      pending: layoutPending,
      onConfirm: (body) => {
        confirmed = body
      }
    })
    render(panel("waiting"))

    const submit = await screen.findByRole("button", { name: /确认并继续/ })
    submit.click()
    await vi.waitFor(() => expect(confirmed).not.toBeNull())
    expect(confirmed).not.toHaveProperty("groups")
  })

  it("已有分组表被布局步骤拒收时可以按空表重写", async () => {
    const rejected = pending()
    rejected.icons.waiting = 0
    rejected.icons.missing = 0
    rejected.icons.needsNaming = false
    rejected.layout = {
      needsGroups: false,
      hasGroups: true,
      rejected: true,
      failed: true,
      failedMessage: "分组表第 1 项（g1）的 members 至少 2 个 ref",
      waiting: 1
    }
    let confirmed: Record<string, unknown> | null = null
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/settings")) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          settings: { automation: "off", ai: { hasKey: false, baseUrl: "", model: "" } }
        }), { status: 200 }))
      }
      if (url.includes("/api/confirm")) {
        confirmed = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        return Promise.resolve(new Response(JSON.stringify({ ok: true, written: [], job: null }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true, pending: rejected }), { status: 200 }))
    })
    render(panel("waiting"))

    expect(await screen.findByText(/插件在布局步骤拒绝了它/)).toBeTruthy()
    screen.getByRole("button", { name: /按空表重写并继续/ }).click()
    await vi.waitFor(() => expect(confirmed).not.toBeNull())
    expect(confirmed).toEqual(expect.objectContaining({ groups: [] }))
  })

  it("已有分组表被布局步骤拒收时可以重新自动分组", async () => {
    const rejected = pending()
    rejected.icons.waiting = 0
    rejected.icons.missing = 0
    rejected.icons.needsNaming = false
    rejected.layout = {
      needsGroups: false,
      hasGroups: true,
      rejected: true,
      failed: true,
      failedMessage: "分组表第 1 项（g1）的 members 至少 2 个 ref",
      waiting: 1
    }
    let regrouped: Record<string, unknown> | null = null
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/settings")) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          settings: { automation: "off", ai: { hasKey: false, baseUrl: "", model: "" } }
        }), { status: 200 }))
      }
      if (url.includes("/api/layout-groups/suggest")) {
        regrouped = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          groups: [],
          written: [{ path: "layout-groups.json", count: 0 }],
          job: null
        }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true, pending: rejected }), { status: 200 }))
    })
    render(panel("waiting"))

    const regroup = await screen.findByRole("button", { name: /重新自动分组并继续/ })
    await vi.waitFor(() => expect(regroup.hasAttribute("disabled")).toBe(false))
    regroup.click()
    await vi.waitFor(() => expect(regrouped).not.toBeNull())
    expect(regrouped).toEqual(expect.objectContaining({
      projectRoot: drive("D", "work", "task-1"),
      target: "DemoPage",
      taskId: "task-1",
      runId: "job-1",
      resume: true
    }))
  })

  it("布局步骤因其他错误失败时只显示原话，不给覆盖分组表的动作", async () => {
    const failed = pending()
    failed.icons.waiting = 0
    failed.icons.missing = 0
    failed.icons.needsNaming = false
    failed.layout = {
      needsGroups: false,
      hasGroups: false,
      rejected: false,
      failed: true,
      failedMessage: "推导失败：节点没有归宿",
      waiting: 0
    }
    stubWith({ pending: failed })
    render(panel("waiting"))

    expect(await screen.findByText("布局步骤没有通过")).toBeTruthy()
    expect(screen.getByText("推导失败：节点没有归宿")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /按空表重写/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /重新自动分组/ })).toBeNull()
    expect(screen.queryByText("这个页面当前没有要填的东西。")).toBeNull()
  })

  it("没有来源运行时，布局恢复说明不承诺继续", async () => {
    const noSource = pending()
    noSource.icons.waiting = 0
    noSource.icons.missing = 0
    noSource.icons.needsNaming = false
    noSource.layout = {
      needsGroups: true,
      hasGroups: false,
      rejected: false,
      failed: false,
      failedMessage: "",
      waiting: 1
    }
    stubWith({ pending: noSource })
    render(panel("waiting", { runId: "" }))

    expect(await screen.findByText(/来源运行已不可用，不会继续/)).toBeTruthy()
    expect(screen.getByRole("button", { name: /按空表重写$/ })).toBeTruthy()
    expect(screen.queryByText(/并从布局步骤继续/)).toBeNull()
  })
})
