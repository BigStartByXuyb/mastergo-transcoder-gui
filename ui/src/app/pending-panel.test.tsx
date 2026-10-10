import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PendingPanel } from "@/app/pending-panel"
import type { Pending } from "@/lib/api"
import { drive } from "@/lib/settings-fixtures"

/*
 * 待确认面板：清单渲染与「确认并继续」的门禁。
 * 跑着的时候不给续跑这一条与布局确认面板同一处判据（ui/src/lib/task-state.ts 的 isInFlight），
 * 这里只验这个入口真的按它拦住了、并把原因说出来。
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
      mustName: [{ index: 1, name: "", sourceId: "1:9", controlType: "IconButton", text: "确定", fromDsl: false }],
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
    layout: { needsGroups: false, waiting: 0, controls: [] }
  } as unknown as Pending
}

function stub() {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/settings")) {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, settings: { automation: "off", layoutAutoPass: false, ai: { hasKey: false, baseUrl: "", model: "" } } }), { status: 200 })
      )
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true, pending: pending() }), { status: 200 }))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function panel(state: string) {
  return (
    <PendingPanel
      projectRoot={drive("D", "work", "task-1")}
      target="DemoPage"
      taskId="task-1"
      runId="job-1"
      state={state}
      automation="off"
    />
  )
}

describe("PendingPanel", () => {
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
})
