import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsRuntimePanel } from "@/app/settings-runtime-panel"
import type { RuntimeProbeResult, RuntimeStatus } from "@/lib/api"
import { drive, healthFixture, okResponse } from "@/lib/settings-fixtures"

/*
 * 「运行环境」这一页：只读事实（客户端/插件/引擎/入口）+ 一张表（名称/版本/来源/操作）。
 * 每行的「来源」开弹窗选那一份从哪儿来；自带的包从哪儿下也在那个弹窗里。
 * 走真的 api 层，只把 fetch 换成一份可写的桩。
 */

function runtime(): RuntimeStatus {
  const tool = (id: "node" | "pwsh" | "claude", patch: Partial<RuntimeStatus["tools"][number]>) => ({
    id: id,
    label: id === "node" ? "Node.js" : (id === "pwsh" ? "PowerShell 7" : "Claude Code"),
    pinned: id === "claude" ? "" : (id === "node" ? "24.21.0" : "7.6.6"),
    path: drive("D", "app", "runtime", id, "node.exe"),
    installed: id !== "claude",
    source: (id === "claude" ? "system" : "bundled") as RuntimeStatus["tools"][number]["source"],
    versions: id === "claude" ? [] : [id === "node" ? "24.21.0" : "7.6.6"],
    active: id === "claude" ? "" : (id === "node" ? "24.21.0" : "7.6.6"),
    system: { ok: id === "claude", version: id === "claude" ? "2.1.278" : "", path: "" },
    downloadUrl: "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip",
    officialUrl: "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip",
    fileName: "node-v24.21.0-win-x64.zip",
    version: id === "claude" ? "2.1.278" : (id === "node" ? "24.21.0" : "7.6.6"),
    ready: true,
    switchable: false,
    note: id === "claude" ? "检测到就用；不代下载。" : "",
    ...patch
  })
  return {
    root: drive("D", "app", "runtime"),
    mirror: "",
    tools: [tool("node", {}), tool("pwsh", {}), tool("claude", {})],
    busy: "",
    error: null,
    task: { phase: "idle", tool: "", received: 0, size: 0, error: null, version: "", startedAt: "" }
  }
}

const PROBE: RuntimeProbeResult[] = [
  { id: "node", label: "Node.js", fileName: "node-v24.21.0-win-x64.zip", url: "http://10.0.0.9/runtime/node-v24.21.0-win-x64.zip", ok: true, status: 200, note: "" },
  { id: "pwsh", label: "PowerShell 7", fileName: "PowerShell-7.6.6-win-x64.zip", url: "http://10.0.0.9/runtime/PowerShell-7.6.6-win-x64.zip", ok: false, status: 404, note: "HTTP 404" }
]

function stub() {
  // 可写的设置桩：system 逐份、mirror 一个地址（POST /api/settings 会把改动合并进去）。
  const state = { system: { node: false, pwsh: false }, mirror: "" }
  const settings = () => ({ ok: true, settings: { runtime: state } })
  let holdNext = false
  let pendingResolve: ((response: Response) => void) | null = null
  let pendingPayload: unknown = null
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/health")) return okResponse(healthFixture("0.6.41"))
      if (url.includes("/api/runtime/status")) return okResponse({ ok: true, status: runtime() })
      if (url.includes("/api/runtime/download")) return okResponse({ ok: true, started: true, tool: "node", note: "", status: runtime() })
      if (url.includes("/api/runtime/probe")) {
        const payload = { ok: true, base: state.mirror || "http://10.0.0.9/runtime", results: PROBE }
        if (holdNext) {
          holdNext = false
          pendingPayload = payload
          return new Promise<Response>((resolve) => { pendingResolve = resolve })
        }
        return okResponse(payload)
      }
      if (url.includes("/api/settings")) {
        if (init && init.body) {
          const body = JSON.parse(String(init.body)) as { runtime?: { system?: Partial<typeof state.system>; mirror?: string } }
          if (body.runtime) {
            if (body.runtime.system) state.system = { ...state.system, ...body.runtime.system }
            if (typeof body.runtime.mirror === "string") state.mirror = body.runtime.mirror
          }
        }
        return okResponse(settings())
      }
      return okResponse({ ok: true })
    })
  )
  return {
    state,
    holdNextProbe: () => { holdNext = true },
    releaseProbe: () => {
      const resolve = pendingResolve
      pendingResolve = null
      if (resolve) resolve(new Response(JSON.stringify(pendingPayload), { status: 200 }))
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SettingsRuntimePanel", () => {
  it("一张表说明现在用什么；每行的「来源」开弹窗选它从哪儿来", async () => {
    const probe = stub()
    render(<SettingsRuntimePanel />)

    // 只读事实来自 /api/health
    await waitFor(() => expect(screen.getByText("v0.6.41")).toBeTruthy())
    expect(screen.getByText("已登记页面帧")).toBeTruthy()

    // 一张表：名称 / 版本 / 来源 / 操作
    await waitFor(() => expect(screen.getByText("Node.js")).toBeTruthy())
    for (const header of ["名称", "版本", "操作"]) expect(screen.getByText(header)).toBeTruthy()
    expect(screen.getAllByText("来源").length).toBeGreaterThan(0)
    expect(screen.getByText("PowerShell 7")).toBeTruthy()
    expect(screen.getByText("Claude Code")).toBeTruthy()
    expect(screen.getAllByText("客户端自带")).toHaveLength(2)
    expect(screen.getByText("系统检测")).toBeTruthy()
    expect(screen.getByText("钉 v24.21.0")).toBeTruthy()

    // claude 没有「来源」可选（不是我们带的），另外两行有
    expect(screen.getAllByRole("button", { name: "来源" })).toHaveLength(2)

    // Node.js 那一行的「来源」→ 弹窗：两个选项 + 官方地址
    fireEvent.click(screen.getAllByRole("button", { name: "来源" })[0])
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Node.js 的来源")).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: /客户端自带/ }).getAttribute("aria-current")).toBe("true")
    expect(within(dialog).getByRole("button", { name: /系统上那一份/ })).toBeTruthy()
    expect(within(dialog).getByText(/nodejs\.org\/dist\/v24\.21\.0/)).toBeTruthy()

    // 选「系统上那一份」：下面只显示那一块的配置（检测到哪一版），保存只改 node 这一份
    fireEvent.click(within(dialog).getByRole("button", { name: /系统上那一份/ }))
    await waitFor(() => expect(within(dialog).getByText(/本机检测到/)).toBeTruthy())
    expect(within(dialog).queryByText(/官方地址/)).toBeNull()
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }))
    await waitFor(() => expect(probe.state.system).toEqual({ node: true, pwsh: false }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    // 再开一次：切回自带 + 安装包从内网取 → 检查 → 保存
    fireEvent.click(screen.getAllByRole("button", { name: "来源" })[0])
    const again = await screen.findByRole("dialog")
    fireEvent.click(within(again).getByRole("button", { name: /客户端自带/ }))
    fireEvent.click(within(again).getByText(/安装包从内网地址取/))
    fireEvent.change(within(again).getByPlaceholderText("例如 http://内网地址/runtime"), {
      target: { value: "http://10.0.0.9/runtime" }
    })
    fireEvent.click(within(again).getByRole("button", { name: "检查" }))
    await waitFor(() => expect(within(again).getByText(/Node\.js：找到了/)).toBeTruthy())
    expect(within(again).getByText(/PowerShell 7：没找到（HTTP 404）/)).toBeTruthy()

    // 在途的检查也要作废：还没回来就改地址 —— 旧结论不许贴上来
    probe.holdNextProbe()
    fireEvent.click(within(again).getByRole("button", { name: "检查" }))
    fireEvent.change(within(again).getByPlaceholderText("例如 http://内网地址/runtime"), {
      target: { value: "http://10.0.0.9/another" }
    })
    probe.releaseProbe()
    await waitFor(() => expect(within(again).queryByText(/Node\.js：找到了/)).toBeNull())

    fireEvent.click(within(again).getByRole("button", { name: "保存" }))
    await waitFor(() => expect(probe.state.mirror).toBe("http://10.0.0.9/another"))
    expect(probe.state.system).toEqual({ node: false, pwsh: false })
  })
})
