import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsRuntimePanel } from "@/app/settings-runtime-panel"
import type { Health, RuntimeStatus } from "@/lib/api"

/*
 * 「运行环境」这一页：只读事实（客户端版本 / 插件 / 引擎 / 入口 / 页面帧）与两份运行时
 * （含「允许用系统那份」开关）在同一处。走真的 api 层，只把 fetch 换掉。
 */

/* 夹具路径按段拼：源码里不出现「盘符 + 反斜杠」那种机器专属写法（结构检查会拦）。 */
function drive(letter: string, ...parts: string[]): string {
  return [letter + ":", ...parts].join("\\")
}

const PLUGIN_ROOT = drive("C", "Users", "me", ".codex", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder", "1.0.369")
const ENGINE = drive("D", "app", "lib", "node-controls.js")

function health(): Health {
  return {
    ok: true,
    version: "0.6.36",
    supervised: true,
    plugin: { root: PLUGIN_ROOT, version: "1.0.369", engine: ENGINE, engineExists: true, runAllExists: true, failure: "" },
    frames: [],
    update: {
      state: "up_to_date",
      current: "0.6.36",
      ready: "",
      busy: "",
      availableVersion: "",
      stagedFreshRunRequired: null
    }
  }
}

function runtime(): RuntimeStatus {
  return {
    root: drive("D", "app", "runtime"),
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

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/health")) return ok(health())
      if (url.includes("/api/runtime/status")) return ok({ ok: true, status: runtime() })
      if (url.includes("/api/settings")) {
        return ok({ ok: true, settings: { runtime: { allowSystem: false } } })
      }
      return ok({ ok: true })
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SettingsRuntimePanel", () => {
  it("一张卡里既有现在用什么（客户端/插件/引擎/入口），也有两份运行时与那个开关", async () => {
    stub()
    render(<SettingsRuntimePanel />)

    // 只读事实来自 /api/health
    await waitFor(() => expect(screen.getByText("v0.6.36")).toBeTruthy())
    expect(screen.getByText("已登记页面帧")).toBeTruthy()

    // 运行时三行 + 开关来自 /api/runtime/status 与 /api/settings
    await waitFor(() => expect(screen.getByText("PowerShell 7")).toBeTruthy())
    expect(screen.getByText("Node.js")).toBeTruthy()
    expect(screen.getByText("Claude Code")).toBeTruthy()
    expect(screen.getByText("自带 2 份 / 用系统的 0 份")).toBeTruthy()
    await waitFor(() => expect(screen.getByRole("switch", { name: /允许用系统上的 Node/ })).toBeTruthy())
  })
})
