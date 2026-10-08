import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PluginCard } from "@/app/plugin-card"
import type { PluginSource, PluginSources, PluginUpdateStatus } from "@/lib/api"
import { INSTALLED_ROOT, INSTALL_PARENT, PLUGIN_SOURCE_BASE, drive, pluginUpdateFixture } from "@/lib/settings-fixtures"

/*
 * 插件页：查找顺序（后端给的那七档，界面不重排）+ 一张表（来源 / 版本 / 状态 / 路径 / 操作）。
 * 这一页只读与查看 —— 没有任何「换用某一档」的动作；只有客户端自带那一份带管理面板
 * （检查更新 / 下载并安装 / 更新来源）。
 * 档位的名字与那句话都由后端给，界面只渲染 —— 这里用夹具名即可，真名由后端用例锁
 * （tests/plugin-sources.test.js 比的是 lib/plugin-root.js 的 pluginPlaces()）。
 *
 * 夹具路径按段拼（drive 在 settings-fixtures 里）：源码里不出现「盘符 + 反斜杠」那种机器专属写法。
 */
const CODEX_CACHE = drive("C", "Users", "me", ".codex", "plugins", "cache")
const CODEX_ROOT = drive("C", "Users", "me", ".codex", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder", "1.0.369")
const CLAUDE_CACHE = drive("C", "Users", "me", ".claude", "plugins", "cache")
const CLAUDE_ROOT = drive("C", "Users", "me", ".claude", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder")
const ENV_DIR = drive("D", "old-plugin")
const ENV_ROOT = drive("D", "mine", "mastergo-wpf-transcoder")

function source(id: PluginSource["id"], over: Partial<PluginSource> = {}): PluginSource {
  return {
    id: id,
    label: id,
    path: "p/" + id,
    exists: false,
    pluginRoot: "",
    version: "",
    found: [],
    active: false,
    note: "（夹具）",
    ...over
  }
}

/**
 * 一台同时装着几份的机器：Codex 缓存（正在用）、Claude 缓存、环境变量指到别处、客户端自带；
 * 启动参数那两档没设（照旧列出来，标「没有」）。响应按生产类型写：接口加字段这里就会被 tsc 拦下来。
 */
function view(options: { activeId?: string; failure?: string; sameRoot?: boolean } = {}): PluginSources {
  const activeId = options.activeId ?? "codex-cache"
  const installRoot = options.sameRoot ? CODEX_ROOT : INSTALLED_ROOT
  const sources: PluginSource[] = [
    source("arg", { label: "启动参数 --plugin" }),
    source("env", {
      label: "环境变量（夹具）",
      note: "系统环境变量给的那一份：在系统里设（或启动前设），客户端启动时继承。",
      path: ENV_DIR,
      exists: true,
      pluginRoot: ENV_ROOT,
      version: "2.0.0",
      found: [ENV_ROOT],
      active: activeId === "env"
    }),
    source("codex-cache", {
      label: "Codex 插件缓存",
      path: CODEX_CACHE,
      exists: true,
      pluginRoot: CODEX_ROOT,
      version: "1.0.369",
      found: [CODEX_ROOT],
      active: activeId === "codex-cache"
    }),
    source("codex-market", { label: "Codex 插件市场", path: drive("C", "Users", "me", ".codex", "plugins", "marketplaces") }),
    source("claude-cache", {
      label: "Claude 插件缓存",
      path: CLAUDE_CACHE,
      exists: true,
      pluginRoot: CLAUDE_ROOT,
      version: "1.0.245",
      found: ["a", "b", "c", "d"],
      active: activeId === "claude-cache"
    }),
    source("claude-market", { label: "Claude 插件市场", path: drive("C", "Users", "me", ".claude", "plugins", "marketplaces") }),
    source("install", {
      label: "客户端自带",
      path: INSTALL_PARENT,
      exists: true,
      pluginRoot: installRoot,
      version: "1.0.369",
      found: [installRoot],
      active: activeId === "install"
    })
  ]
  const active = sources.find((item) => item.active)
  return {
    ok: true,
    plugin: {
      root: active ? active.pluginRoot : "",
      version: active ? active.version : "",
      engine: drive("D", "app", "lib", "node-controls.js"),
      engineExists: true,
      runAllExists: true,
      failure: options.failure ?? ""
    },
    sources: sources
  }
}

function stub(
  payload: PluginSources,
  hooks: {
    update?: PluginUpdateStatus
    onCheck?: () => void
    onInstall?: () => void
    onOpenFolder?: (body: unknown) => void
    /** 记下每一次请求（用例看「打了哪些接口」）。 */
    onRequest?: (url: string, body: unknown) => void
    /** 装插件那一次挂在这里的 Promise 上（用例要停在「正在装」那一瞬间）。 */
    installResponse?: Promise<Response>
  } = {}
) {
  vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(_input)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    hooks.onRequest?.(url, body)
    if (url.includes("/api/plugin/update/status")) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, status: hooks.update ?? pluginUpdateFixture() }), { status: 200 }))
    }
    if (url.includes("/api/plugin/update/check")) {
      hooks.onCheck?.()
      return Promise.resolve(new Response(JSON.stringify({ ok: true, status: hooks.update ?? pluginUpdateFixture() }), { status: 200 }))
    }
    if (url.includes("/api/plugin/update/install")) {
      hooks.onInstall?.()
      if (hooks.installResponse) return hooks.installResponse
      const status = pluginUpdateFixture({ task: { phase: "done", done: 3, total: 3, downloaded: 3, error: null } })
      return Promise.resolve(new Response(JSON.stringify({ ok: true, started: true, version: "1.0.372", note: "", status }), { status: 200 }))
    }
    if (url.includes("/api/system/open-folder")) {
      hooks.onOpenFolder?.(body)
      return Promise.resolve(new Response(JSON.stringify({ ok: true, reason: "" }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 点开某一行（表里那一行的「详情…／管理…」）。 */
async function openRow(name: string, action: string) {
  const table = within(await screen.findByRole("table"))
  const row = table.getByText(name).closest("tr") as HTMLElement
  fireEvent.click(within(row).getByRole("button", { name: action }))
  return await screen.findByRole("dialog")
}

describe("PluginCard", () => {
  it("一张表列全部档位：顺序来自后端，正在用的只标一处", async () => {
    stub(view())
    render(<PluginCard />)
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Codex 插件缓存")).toBeTruthy())

    const table = within(screen.getByRole("table"))
    // 七档都在同一张表里，没设的那两档也列出来（标「没有」）。
    expect(table.getByText("启动参数 --plugin")).toBeTruthy()
    expect(table.getByText("环境变量（夹具）")).toBeTruthy()
    expect(table.getByText("Codex 插件市场")).toBeTruthy()
    expect(table.getByText("Claude 插件缓存")).toBeTruthy()
    expect(table.getByText("Claude 插件市场")).toBeTruthy()
    expect(table.getByText("客户端自带")).toBeTruthy()
    expect(screen.getAllByText("正在用").length).toBe(1)
    // 只读页：没有任何「换用某一档」的动作。
    expect(screen.queryByText("用这份")).toBeNull()
  })

  it("顺序条把每一档的处境写出来，同一份插件只算一次", async () => {
    stub(view({ sameRoot: true }))
    render(<PluginCard />)
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Codex 插件缓存")).toBeTruthy())

    // 客户端自带与 Codex 缓存指向同一个插件根：七档只列出六行（后一档并进最先命中的那档）。
    const table = within(screen.getByRole("table"))
    expect(screen.getAllByRole("row").length).toBe(7) // 表头 1 + 数据 6
    expect(table.getByText("同时来自：客户端自带")).toBeTruthy()
    // 顺序条上那一档照旧列出来，标出它与第几档是同一份。
    expect(await screen.findByText(/与第 3 档同一份/)).toBeTruthy()
  })

  it("自带那一行写着它自己的更新状态，点「管理…」开面板", async () => {
    stub(view({ activeId: "install" }))
    render(<PluginCard />)
    const dialog = await openRow("客户端自带", "管理…")

    expect(within(dialog).getByText("客户端自带")).toBeTruthy()
    expect(within(dialog).getByText("修改发布源")).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: /已是最新版|下载并安装|更新到/ })).toBeTruthy()
  })

  it("点别的行开的是详情：只读信息，不给「用这份」", async () => {
    stub(view())
    render(<PluginCard />)
    const dialog = await openRow("环境变量（夹具）", "详情…")

    // 「这一档归谁管」那句话由后端随来源一起给，界面只渲染。
    expect(within(dialog).getByText(/系统环境变量给的那一份/)).toBeTruthy()
    expect(within(dialog).getByText(/解析到：/)).toBeTruthy()
    expect(within(dialog).queryByText("用这份")).toBeNull()
    expect(within(dialog).queryByText("检查更新")).toBeNull()
  })

  it("一处都没找到时把后端列出来的已查找路径原样显示", async () => {
    const missing = drive("C", "a")
    stub(view({ failure: "找不到 mastergo-wpf-transcoder 插件。\n已查找：" + missing + "（没有）" }))
    render(<PluginCard />)

    expect(await screen.findByText("没找到插件")).toBeTruthy()
    expect(screen.getByText(new RegExp("已查找：" + missing.replace(/\\/g, "\\\\") + "（没有）"))).toBeTruthy()
  })

  it("「更新来源」在自带那一行的管理面板里，点「修改发布源」开的是插件这一半的弹窗", async () => {
    stub(view({ activeId: "install" }))
    render(<PluginCard />)
    const dialog = await openRow("客户端自带", "管理…")
    fireEvent.click(within(dialog).getByRole("button", { name: "修改发布源" }))

    // 地址栏预填的是插件那条发布源（插件自己那一项设置）。
    await waitFor(() => expect(screen.getByDisplayValue(PLUGIN_SOURCE_BASE)).toBeTruthy())
    expect(screen.getAllByText(/插件（流水线）/).length).toBeGreaterThan(0)
  })

  it("「检查更新」在自带那一行的管理面板里，打到插件那条接口", async () => {
    const calls: string[] = []
    stub(view({ activeId: "install" }), { onRequest: (url) => calls.push(url) })
    render(<PluginCard />)
    const dialog = await openRow("客户端自带", "管理…")

    fireEvent.click(within(dialog).getByRole("button", { name: "检查更新" }))
    await waitFor(() => expect(calls.some((url) => url.includes("/api/plugin/update/check"))).toBe(true))
  })

  it("正在传时，自带那一行的管理面板里「检查更新」与「下载并安装」都不给点", async () => {
    stub(view({ activeId: "install" }), {
      update: pluginUpdateFixture({
        state: "update_available",
        available: { version: "1.0.372", tag: "v1.0.372", releasedAt: "", changed: 2, removed: 0, total: 12, checkedAt: "" },
        task: { phase: "downloading", done: 1, total: 3, downloaded: 1, error: null }
      })
    })
    render(<PluginCard />)
    const dialog = await openRow("客户端自带", "管理…")

    expect(within(dialog).getByRole("button", { name: "检查更新" }).hasAttribute("disabled")).toBe(true)
    expect(within(dialog).getByRole("button", { name: /更新到 v1.0.372/ }).hasAttribute("disabled")).toBe(true)
  })
})
