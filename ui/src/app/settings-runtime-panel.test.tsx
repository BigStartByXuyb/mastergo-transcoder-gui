import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsRuntimePanel } from "@/app/settings-runtime-panel"
import type { RuntimeStatus } from "@/lib/api"
import { drive, healthFixture, okResponse } from "@/lib/settings-fixtures"

/*
 * 「运行环境」这一页：只读事实（客户端版本 / 插件 / 引擎 / 入口 / 页面帧）与两份运行时
 * （含「允许用系统那份」开关）在同一处。走真的 api 层，只把 fetch 换掉。
 */

const health = () => healthFixture("0.6.37")

function runtime(): RuntimeStatus {
  return {
    root: drive("D", "app", "runtime"),
    mirror: "",
    tools: [
      {
        id: "node",
        label: "Node.js",
        pinned: "24.21.0",
        path: drive("D", "app", "runtime", "node", "24.21.0", "node.exe"),
        installed: true,
        source: "bundled",
        versions: ["24.21.0"],
        active: "24.21.0",
        system: { ok: false, version: "", path: "" },
        downloadUrl: "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip",
        officialUrl: "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip",
        fileName: "node-v24.21.0-win-x64.zip",
        version: "24.21.0",
        ready: true,
        switchable: false,
        note: ""
      },
      {
        id: "pwsh",
        label: "PowerShell 7",
        pinned: "7.6.6",
        path: drive("D", "app", "runtime", "pwsh", "7.6.6", "pwsh.exe"),
        installed: true,
        source: "bundled",
        versions: ["7.6.6"],
        active: "7.6.6",
        system: { ok: false, version: "", path: "" },
        downloadUrl: "https://github.com/PowerShell/PowerShell/releases/download/v7.6.6/PowerShell-7.6.6-win-x64.zip",
        officialUrl: "https://github.com/PowerShell/PowerShell/releases/download/v7.6.6/PowerShell-7.6.6-win-x64.zip",
        fileName: "PowerShell-7.6.6-win-x64.zip",
        version: "7.6.6",
        ready: true,
        switchable: false,
        note: ""
      },
      {
        id: "claude",
        label: "Claude Code",
        pinned: "",
        path: drive("C", "Users", "me", ".local", "bin", "claude.exe"),
        installed: false,
        source: "system",
        versions: [],
        active: "",
        system: { ok: true, version: "2.1.278", path: drive("C", "Users", "me", ".local", "bin", "claude.exe") },
        downloadUrl: "",
        officialUrl: "",
        fileName: "",
        version: "2.1.278",
        ready: true,
        switchable: false,
        note: "检测到就用；不代下载。"
      }
    ],
    busy: "",
    error: null,
    task: { phase: "idle", tool: "", received: 0, size: 0, error: null, version: "", startedAt: "" }
  }
}

function stub() {
  // 设置是可写的桩：存了镜像之后，运行时状态跟着回新的 —— 这是「保存后立刻刷新」那条路径。
  let savedMirror = ""
  // 探测默认立刻返回；`holdNextProbe()` 之后下一次改成「挂着不结算」，用来验在途请求被作废那条路。
  let holdNext = false
  let pendingResolve: ((response: Response) => void) | null = null
  let pendingPayload: unknown = null
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/health")) return okResponse(health())
      if (url.includes("/api/runtime/status")) {
        const payload = runtime()
        payload.mirror = savedMirror
        if (savedMirror) {
          payload.tools = payload.tools.map((tool) => {
            if (tool.id !== "node") return tool
            return { ...tool, downloadUrl: savedMirror + "/node-v24.21.0-win-x64.zip" }
          })
        }
        return okResponse({ ok: true, status: payload })
      }
      if (url.includes("/api/settings")) {
        if (init && init.body) {
          const body = JSON.parse(String(init.body)) as { runtime?: { mirror?: string } }
          if (body.runtime && typeof body.runtime.mirror === "string") savedMirror = body.runtime.mirror
        }
        return okResponse({ ok: true, settings: { runtime: { allowSystem: false, mirror: savedMirror } } })
      }
      if (url.includes("/api/runtime/probe")) {
        const payload = {
          ok: true,
          base: "http://10.0.0.9/runtime",
          results: [
            { id: "node", label: "Node.js", fileName: "node-v24.21.0-win-x64.zip", url: "http://10.0.0.9/runtime/node-v24.21.0-win-x64.zip", ok: true, status: 200, note: "" },
            { id: "pwsh", label: "PowerShell 7", fileName: "PowerShell-7.6.6-win-x64.zip", url: "http://10.0.0.9/runtime/PowerShell-7.6.6-win-x64.zip", ok: false, status: 404, note: "HTTP 404" }
          ]
        }
        if (holdNext) {
          holdNext = false
          pendingPayload = payload
          return new Promise<Response>((resolve) => { pendingResolve = resolve })
        }
        return okResponse(payload)
      }
      return okResponse({ ok: true })
    })
  )
  return {
    holdNextProbe: () => {
      holdNext = true
    },
    releaseProbe: () => {
      const resolve = pendingResolve
      pendingResolve = null
      if (resolve) resolve(new Response(JSON.stringify(pendingPayload), { status: 200 }))
    },
    failProbe: () => {
      const resolve = pendingResolve
      pendingResolve = null
      if (resolve) resolve(new Response(JSON.stringify({ ok: false, error: { code: "PROBE_BOOM", message: "探测炸了", hint: "" } }), { status: 400 }))
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SettingsRuntimePanel", () => {
  it("一张卡里既有现在用什么（客户端/插件/引擎/入口），也有两份运行时与那个开关", async () => {
    const probe = stub()
    render(<SettingsRuntimePanel />)

    // 只读事实来自 /api/health
    await waitFor(() => expect(screen.getByText("v0.6.37")).toBeTruthy())
    expect(screen.getByText("已登记页面帧")).toBeTruthy()

    // 运行时三行 + 开关来自 /api/runtime/status 与 /api/settings
    await waitFor(() => expect(screen.getByText("PowerShell 7")).toBeTruthy())
    expect(screen.getByText("Node.js")).toBeTruthy()
    expect(screen.getByText("Claude Code")).toBeTruthy()
    expect(screen.getByText("自带 2 份 / 用系统的 0 份")).toBeTruthy()
    await waitFor(() => expect(screen.getByRole("switch", { name: /允许用系统上的 Node/ })).toBeTruthy())
    /*
     * 安装包来源：默认关着（走官方地址）—— 输入框不露出来，先把「哪两份程序的包」说清楚；
     * 打开开关才露出地址框。
     */
    const sourceSwitch = screen.getByRole("switch", { name: /从内网地址取安装包/ })
    expect(screen.getByText(/Node\.js 与 PowerShell 7/)).toBeTruthy()
    expect(screen.queryByPlaceholderText("例如 http://10.0.0.9/runtime")).toBeNull()
    fireEvent.click(sourceSwitch)
    const address = screen.getByPlaceholderText("例如 http://10.0.0.9/runtime")

    // 填镜像保存：输入框立刻换成存下来的值，每行那个地址也立刻跟着换（不等下一轮轮询）。
    fireEvent.change(address, { target: { value: "http://10.0.0.9/runtime" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(screen.getByText(/10\.0\.0\.9\/runtime\/node-v24\.21\.0-win-x64\.zip/)).toBeTruthy())

    // 「检查这个地址」：哪个文件在、哪个不在，当场说清楚（不用先存再等下载失败）。
    fireEvent.click(screen.getByRole("button", { name: "检查这个地址" }))
    await waitFor(() => expect(screen.getByText(/Node\.js：找到了/)).toBeTruthy())
    expect(screen.getByText(/PowerShell 7：没找到（HTTP 404）/)).toBeTruthy()

    /*
     * 在途的那次检查也要作废：点完「检查」还没回来，地址就改了 —— 旧结论不许再贴上来。
     */
    probe.holdNextProbe()
    fireEvent.click(screen.getByRole("button", { name: "检查这个地址" }))
    fireEvent.change(screen.getByPlaceholderText("例如 http://10.0.0.9/runtime"), { target: { value: "http://10.0.0.9/another" } })
    probe.releaseProbe()
    await waitFor(() => expect(screen.queryByText(/Node\.js：找到了/)).toBeNull())

    // 失败也一样：旧地址的报错不该挂到新地址上。
    probe.holdNextProbe()
    fireEvent.click(screen.getByRole("button", { name: "检查这个地址" }))
    fireEvent.change(screen.getByPlaceholderText("例如 http://10.0.0.9/runtime"), { target: { value: "http://10.0.0.9/third" } })
    probe.failProbe()
    await waitFor(() => expect(screen.queryByText(/探测炸了/)).toBeNull())

    // 关掉开关＝改回官方地址（这一下立刻落盘，不用再点保存），输入框跟着收起来。
    fireEvent.click(screen.getByRole("switch", { name: /从内网地址取安装包/ }))
    await waitFor(() => expect(screen.queryByPlaceholderText("例如 http://10.0.0.9/runtime")).toBeNull())
  })
})
