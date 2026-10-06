import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsUpdatePanel } from "@/app/settings-update-panel"
import type { PluginSources, UpdateStatus } from "@/lib/api"
import {
  ENGINE,
  PLUGIN_ROOT,
  drive,
  healthFixture,
  okResponse,
  pluginUpdateFixture
} from "@/lib/settings-fixtures"

/*
 * 更新页里的两段切换：客户端与插件（流水线）。
 * 走真的 api 层（只把 fetch 换掉），每个接口回一份符合生产类型的最小载荷 ——
 * 空壳响应会让卡片在读字段时抛错，用例也就只在「数据还没到」的骨架上成立。
 */

const health = () => healthFixture("0.6.34")

function sources(): PluginSources {
  return {
    ok: true,
    plugin: { root: PLUGIN_ROOT, version: "1.0.369", engine: ENGINE, engineExists: true, runAllExists: true, failure: "" },
    chosen: "",
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
      },
      {
        // 客户端自带的那一份也在这张表里（0.6.50 起客户端能自己装一份）：它那一行带更新状态。
        id: "install",
        label: "客户端自带",
        path: drive("C", "Users", "me", "app", "plugins"),
        kind: "install",
        exists: true,
        pluginRoot: drive("C", "Users", "me", "app", "plugins", "mastergo-wpf-transcoder", "1.0.369"),
        version: "1.0.369",
        found: [drive("C", "Users", "me", "app", "plugins", "mastergo-wpf-transcoder", "1.0.369")],
        active: false
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

function stub() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/health")) return okResponse(health())
      if (url.includes("/api/plugin/sources")) return okResponse(sources())
      if (url.includes("/api/update/status")) return okResponse({ ok: true, status: status() })
      if (url.includes("/api/plugin/update/status")) return okResponse({ ok: true, status: pluginUpdateFixture() })
      return okResponse({ ok: true })
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
    // 等客户端那一段真的读回数据：这句话来自版本状态，不是骨架上的固定文案。
    await waitFor(() => expect(screen.getByText("已是最新 v0.6.34")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /插件（流水线）/ }))
    expect(onPickPart).toHaveBeenCalledWith("plugin")
    unmount()

    render(<SettingsUpdatePanel part="plugin" onPickPart={onPickPart} />)
    expect(screen.getByRole("button", { name: /插件（流水线）/ }).getAttribute("aria-current")).toBe("true")
    // 顺序条与表里都会出现来源名：这里只要求那一段渲染出来。
    await waitFor(() => expect(screen.getAllByText("Codex 插件缓存").length).toBeGreaterThan(0))
    expect(screen.queryByText("已是最新 v0.6.34")).toBeNull()
    // 自带那一份的状态也在这段里（客户端能自己装一份插件）。
    await waitFor(() => expect(screen.getAllByText("是最新 v1.0.369").length).toBeGreaterThan(0))
  })
})
