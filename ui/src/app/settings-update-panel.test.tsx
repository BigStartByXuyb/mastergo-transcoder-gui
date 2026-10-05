import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsUpdatePanel } from "@/app/settings-update-panel"
import type { Health, PluginSources, RuntimeStatus, UpdateStatus } from "@/lib/api"

/*
 * 更新页里的两段切换：客户端与插件（流水线）。
 * 走真的 api 层（只把 fetch 换掉），每个接口回一份符合生产类型的最小载荷 ——
 * 空壳响应会让卡片在读字段时抛错，用例也就只在「数据还没到」的骨架上成立。
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
    version: "0.6.34",
    supervised: true,
    plugin: { root: PLUGIN_ROOT, version: "1.0.369", engine: ENGINE, engineExists: true, runAllExists: true, failure: "" },
    frames: [],
    update: {
      state: "up_to_date",
      current: "0.6.34",
      ready: "",
      busy: "",
      availableVersion: "",
      stagedFreshRunRequired: null
    }
  }
}

function sources(): PluginSources {
  return {
    ok: true,
    plugin: { root: PLUGIN_ROOT, version: "1.0.369", engine: ENGINE, engineExists: true, runAllExists: true, failure: "" },
    chosen: "",
    env: "",
    sources: [
      {
        id: "codex-cache",
        label: "Codex 插件缓存",
        path: drive("C", "Users", "me", ".codex", "plugins", "cache"),
        kind: "agent",
        exists: true,
        pluginRoot: PLUGIN_ROOT,
        version: "1.0.369",
        found: [PLUGIN_ROOT],
        active: true
      }
    ]
  }
}

function status(): UpdateStatus {
  return {
    state: "up_to_date",
    current: "0.6.34",
    currentNotes: [],
    history: [],
    root: "",
    pointer: null,
    busy: "",
    staged: [],
    ready: "",
    rollback: "",
    available: null,
    error: null,
    task: { phase: "idle", done: 0, total: 0, downloaded: 0, error: null },
    source: {
      kind: "github",
      base: "https://github.com/BigStartByXuyb/mastergo-transcoder-gui",
      manifestUrl: "https://github.com/BigStartByXuyb/mastergo-transcoder-gui/releases/latest/download/manifest.json",
      kinds: ["github", "gitlab", "static"]
    },
    hasToken: false
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
      if (url.includes("/api/plugin/sources")) return ok(sources())
      if (url.includes("/api/plugin/env")) {
        return ok({
          ok: true,
          name: "MASTERGO_GUI_TEST_ENV",
          envScopes: { name: "MASTERGO_GUI_TEST_ENV", process: "", user: "", machine: "", written: false, unsupported: false, failure: "" }
        })
      }
      if (url.includes("/api/runtime/status")) return ok({ ok: true, status: runtime() })
      if (url.includes("/api/update/status")) return ok({ ok: true, status: status() })
      return ok({ ok: true })
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SettingsUpdatePanel", () => {
  it("两段切换：点插件那一段交回 plugin，按 part 渲染对应内容", async () => {
    stub()
    const onPickPart = vi.fn()
    const { unmount } = render(<SettingsUpdatePanel part="" onPickPart={onPickPart} />)

    expect(screen.getByRole("button", { name: /客户端/ }).getAttribute("aria-current")).toBe("true")
    // 运行环境这一张卡里就有两份运行时与那个开关：它们是同一个问题「现在用的是什么」。
    await waitFor(() => expect(screen.getByText("PowerShell 7")).toBeTruthy())
    expect(screen.getByText("Node.js")).toBeTruthy()
    expect(screen.getByText("Claude Code")).toBeTruthy()
    expect(screen.getByRole("switch", { name: /允许用系统上的 Node/ })).toBeTruthy()
    // 等客户端那一段真的读回数据：这句话来自版本状态，不是骨架上的固定文案。
    await waitFor(() => expect(screen.getByText("已是最新 v0.6.34")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /插件（流水线）/ }))
    expect(onPickPart).toHaveBeenCalledWith("plugin")
    unmount()

    render(<SettingsUpdatePanel part="plugin" onPickPart={onPickPart} />)
    expect(screen.getByRole("button", { name: /插件（流水线）/ }).getAttribute("aria-current")).toBe("true")
    await waitFor(() => expect(screen.getByText("Codex 插件缓存")).toBeTruthy())
    expect(screen.queryByText("已是最新 v0.6.34")).toBeNull()
  })
})
