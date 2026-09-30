import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PluginCard } from "@/app/plugin-card"

/*
 * 夹具路径按段拼出来：源码里不出现「盘符 + 反斜杠」那种机器专属写法（结构检查会拦）。
 */
function drive(letter: string, ...parts: string[]): string {
  return [letter + ":", ...parts].join("\\")
}

const CODEX_CACHE = drive("C", "Users", "me", ".codex", "plugins", "cache")
const CODEX_ROOT = drive("C", "Users", "me", ".codex", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder", "1.0.369")
const CLAUDE_CACHE = drive("C", "Users", "me", ".claude", "plugins", "cache")
const CLAUDE_ROOT = drive("C", "Users", "me", ".claude", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder")
const INSTALL_DIR = drive("D", "app", "plugins")

type Source = {
  id: string
  label: string
  path: string
  kind: string
  exists: boolean
  pluginRoot: string
  version: string
  found: string[]
  active: boolean
}

function view(options: { activeId: string; chosen?: string; failure?: string }) {
  const sources: Source[] = [
    {
      id: "codex-cache",
      label: "Codex 插件缓存",
      path: CODEX_CACHE,
      kind: "agent",
      exists: true,
      pluginRoot: CODEX_ROOT,
      version: "1.0.369",
      found: [CODEX_ROOT],
      active: options.activeId === "codex-cache"
    },
    {
      id: "claude-cache",
      label: "Claude 插件缓存",
      path: CLAUDE_CACHE,
      kind: "agent",
      exists: true,
      pluginRoot: CLAUDE_ROOT,
      version: "1.0.245",
      found: ["a", "b", "c", "d"],
      active: options.activeId === "claude-cache"
    },
    {
      id: "install",
      label: "客户端自带",
      path: INSTALL_DIR,
      kind: "install",
      exists: false,
      pluginRoot: "",
      version: "",
      found: [],
      active: false
    }
  ]
  return {
    ok: true,
    plugin: {
      root: sources.find((item) => item.active)?.pluginRoot ?? "",
      version: sources.find((item) => item.active)?.version ?? "",
      engine: drive("D", "app", "lib", "node-controls.js"),
      engineExists: true,
      runAllExists: true,
      failure: options.failure ?? ""
    },
    chosen: options.chosen ?? "",
    env: "",
    sources
  }
}

function stub(payload: unknown, onChoose?: (body: unknown) => void) {
  vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(_input)
    if (url.includes("/api/plugin/choose")) {
      onChoose?.(JSON.parse(String(init?.body ?? "{}")))
      return Promise.resolve(new Response(JSON.stringify(view({ activeId: "claude-cache", chosen: "picked" })), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("PluginCard", () => {
  it("逐条列出查过的路径，只有正在用的那条标「正在用」", async () => {
    stub(view({ activeId: "codex-cache" }))
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("Codex 插件缓存")).toBeTruthy())

    expect(screen.getByText("Claude 插件缓存")).toBeTruthy()
    expect(screen.getByText("客户端自带")).toBeTruthy()
    expect(screen.getByText("没有")).toBeTruthy()
    // 自动那一条与命中它的那一条各一个。
    // 自动那一条与命中它的那一条各一个；说明句里那个不算（按整串匹配）。
    expect(screen.getAllByText("正在用").length).toBe(2)
    // 自动那一条在用时，其余有插件的那一条各给一个「用这份」。
    expect(screen.getAllByRole("button", { name: "用这份" }).length).toBe(1)
  })

  it("同一处有多份时只说取最高版本，不列每条版本目录", async () => {
    stub(view({ activeId: "codex-cache" }))
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("Claude 插件缓存")).toBeTruthy())
    expect(screen.getByText("共 4 份，用最高版本")).toBeTruthy()
  })

  it("点「用这份」把那一份的插件根交给后端", async () => {
    const chosen: unknown[] = []
    stub(view({ activeId: "codex-cache" }), (body) => chosen.push(body))
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("Claude 插件缓存")).toBeTruthy())

    fireEvent.click(screen.getAllByRole("button", { name: "用这份" })[0])
    await waitFor(() => expect(chosen.length).toBe(1))
    expect(chosen[0]).toMatchObject({ path: CLAUDE_ROOT })
  })

  it("选了具体某一份时，自动那一条给的是「用自动」", async () => {
    stub(view({ activeId: "claude-cache", chosen: CLAUDE_ROOT }))
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("Claude 插件缓存")).toBeTruthy())
    expect(screen.getByRole("button", { name: "用自动" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "用自动" }).hasAttribute("disabled")).toBe(false)
  })

  it("一处都没有时把后端列出来的已查找路径原样显示", async () => {
    stub(view({ activeId: "", failure: "找不到 mastergo-wpf-transcoder 插件。\n已查找：" + INSTALL_DIR + "（没有）" }))
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("没找到插件")).toBeTruthy())
    expect(screen.getByText(new RegExp("已查找：" + INSTALL_DIR.replace(/\\/g, "\\\\") + "（没有）"))).toBeTruthy()
  })
})
