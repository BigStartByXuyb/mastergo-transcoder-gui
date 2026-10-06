import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PluginCard } from "@/app/plugin-card"
import type { PluginEnvScopes, PluginSources, PluginUpdateStatus } from "@/lib/api"
import { INSTALLED_ROOT, INSTALL_PARENT, drive, pluginUpdateFixture } from "@/lib/settings-fixtures"

// 夹具路径按段拼（drive 在 settings-fixtures 里）：源码里不出现「盘符 + 反斜杠」那种机器专属写法。
const CODEX_CACHE = drive("C", "Users", "me", ".codex", "plugins", "cache")
const CODEX_ROOT = drive("C", "Users", "me", ".codex", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder", "1.0.369")
const CLAUDE_CACHE = drive("C", "Users", "me", ".claude", "plugins", "cache")
const CLAUDE_ROOT = drive("C", "Users", "me", ".claude", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder")
const INSTALL_DIR = INSTALL_PARENT
// 环境变量那几条用例用的路径同样按段拼，别在源码里出现盘符加反斜杠。
const ENV_OLD = drive("D", "old-plugin")
const ENV_NEW = drive("D", "new-plugin")
// 指到别处去的那一份（与内置位置都不同）。
const MINE_ROOT = drive("D", "mine", "mastergo-wpf-transcoder")

// 响应用生产类型：用例与接口同形，接口加了字段这里就会被 tsc 拦下来。
function view(options: { activeId: string; chosen?: string; failure?: string }): PluginSources {
  const sources: PluginSources["sources"] = [
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

// 故意用一个和生产不一样的名字：页面上的名字只该来自后端，前端不许自己写死。
const STUB_ENV_NAME = "MASTERGO_GUI_TEST_ENV"

/* 「设置里选的」那一条的真实形状：选了之后 API 就会带上它，且它就是生效的那一份。 */
function chosenSource(root: string, version: string): PluginSources["sources"][number] {
  return {
    id: "chosen",
    label: "设置里选的",
    path: root,
    kind: "chosen",
    exists: true,
    pluginRoot: root,
    version: version,
    found: [root],
    active: true
  }
}

function scopes(over: Partial<PluginEnvScopes> = {}): PluginEnvScopes {
  return {
    name: STUB_ENV_NAME,
    process: "",
    user: "",
    machine: "",
    written: false,
    unsupported: false,
    failure: "",
    ...over
  }
}

function stub(
  payload: unknown,
  hooks: {
    onChoose?: (body: unknown) => void
    onEnv?: (body: unknown) => void
    env?: Partial<PluginEnvScopes>
    update?: PluginUpdateStatus
    updateAfterInstall?: PluginUpdateStatus
    onInstall?: () => void
    onCheck?: () => void
  } = {}
) {
  vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(_input)
    if (url.includes("/api/plugin/update/status")) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, status: hooks.update ?? pluginUpdateFixture() }), { status: 200 }))
    }
    if (url.includes("/api/plugin/update/check")) {
      hooks.onCheck?.()
      return Promise.resolve(new Response(JSON.stringify({ ok: true, status: hooks.update ?? pluginUpdateFixture() }), { status: 200 }))
    }
    if (url.includes("/api/plugin/update/install")) {
      hooks.onInstall?.()
      const next = hooks.updateAfterInstall ?? pluginUpdateFixture()
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, started: true, version: "1.0.372", note: "", status: next }), { status: 200 })
      )
    }
    if (url.includes("/api/plugin/choose")) {
      hooks.onChoose?.(JSON.parse(String(init?.body ?? "{}")))
      return Promise.resolve(new Response(JSON.stringify(view({ activeId: "claude-cache", chosen: "picked" })), { status: 200 }))
    }
    if (url.includes("/api/plugin/env")) {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (body) hooks.onEnv?.(body)
      // 保存之后后端回的仍是「本机不支持」那一条：桩要照着回，否则验不出「不谎报已写入」。
      const current = body
        ? { user: String(body.value || ""), written: true, unsupported: hooks.env?.unsupported, failure: hooks.env?.failure }
        : hooks.env
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        name: STUB_ENV_NAME,
        envScopes: scopes(current),
        resolves: true
      }), { status: 200 }))
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
    // 客户端自带那一处没有插件，标一个「没有」。
    expect(screen.getAllByText("没有").length).toBe(1)
    // 只有真正被取用的那条来源标「正在用」；动作块用「现在是自动」这种说法，不抢这个词。
    expect(screen.getAllByText("正在用").length).toBe(1)
    expect(screen.getByText("现在是自动")).toBeTruthy()
    // 有插件又不是生效那份的，才给「用这份」（这里是 Claude 缓存）。
    expect(screen.getAllByRole("button", { name: "用这份" }).length).toBe(1)
  })

  it("同一处有多份时只说取最高版本，不列每条版本目录", async () => {
    stub(view({ activeId: "codex-cache" }))
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("Claude 插件缓存")).toBeTruthy())
    expect(screen.getByText("这一处有 4 份，用最高版本")).toBeTruthy()
  })

  it("按两组摆：本机指定的在前、自动查找的在后，各带表头", async () => {
    // 指针指到别处去时，两张表都在。
    const payload = view({ activeId: "chosen" })
    stub({
      ...payload,
      chosen: MINE_ROOT,
      sources: [chosenSource(MINE_ROOT, "2.0.0"), ...payload.sources]
    })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("自动查找的位置")).toBeTruthy())
    expect(screen.getByText("本机指定的位置")).toBeTruthy()

    // 两张表：表头各出现两次。
    expect(screen.getAllByText("版本").length).toBe(2)
    expect(screen.getAllByText("状态").length).toBe(2)
    expect(screen.getAllByText("路径").length).toBe(2)
    expect(screen.getAllByText("切换").length).toBe(2)
  })

  it("点「用这份」把那一份的插件根交给后端", async () => {
    const chosen: unknown[] = []
    stub(view({ activeId: "codex-cache" }), { onChoose: (body) => chosen.push(body) })
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
    const auto = screen.getByRole("button", { name: "交给客户端找" })
    expect(auto).toBeTruthy()
    expect(auto.hasAttribute("disabled")).toBe(false)
  })

  it("一处都没有时把后端列出来的已查找路径原样显示", async () => {
    stub(view({ activeId: "", failure: "找不到 mastergo-wpf-transcoder 插件。\n已查找：" + INSTALL_DIR + "（没有）" }))
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("没找到插件")).toBeTruthy())
    expect(screen.getByText(new RegExp("已查找：" + INSTALL_DIR.replace(/\\/g, "\\\\") + "（没有）"))).toBeTruthy()
  })

  it("环境变量那段区分「这次运行读到的」与「系统里存的」", async () => {
    stub(view({ activeId: "codex-cache" }), { env: { process: "", user: ENV_OLD } })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("用户级已设置")).toBeTruthy())
    expect(screen.getByText(new RegExp(STUB_ENV_NAME)).textContent).toContain(STUB_ENV_NAME)
    expect(screen.getByText(/这次运行读到：/).textContent).toContain("未设置")
    expect(screen.getByText(/系统里存的（用户级）：/).textContent).toContain(ENV_OLD)
    expect(screen.getByText(/机器级：/).textContent).toContain("未设置")
  })

  it("保存把路径交给后端，清除交的是空串", async () => {
    const sent: unknown[] = []
    stub(view({ activeId: "codex-cache" }), { env: { user: ENV_OLD }, onEnv: (body) => sent.push(body) })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("用户级已设置")).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText("插件目录的绝对路径"), { target: { value: ENV_NEW } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(sent.length).toBe(1))
    expect(sent[0]).toMatchObject({ value: ENV_NEW })

    fireEvent.click(screen.getAllByRole("button", { name: "清除" })[0])
    await waitFor(() => expect(sent.length).toBe(2))
    expect(sent[1]).toMatchObject({ value: "" })
  })

  it("本机不支持这一项时，保存完不说「已写入」", async () => {
    stub(view({ activeId: "codex-cache" }), {
      env: { unsupported: true, failure: "只有 Windows 有用户级环境变量，这一项在本机不可用。" }
    })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText(/只有 Windows/)).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText("插件目录的绝对路径"), { target: { value: ENV_NEW } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() => expect(screen.queryByText(/已写入。/)).toBeNull())
    expect(screen.getByText(/只有 Windows/)).toBeTruthy()
  })

  it("保存过、但这次运行没读到：点破「重启后才生效」", async () => {
    stub(view({ activeId: "codex-cache" }), { env: { user: ENV_OLD, process: "" } })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText(/这两个值不一样/)).toBeTruthy())
  })

  it("这次读到了、界面里却没存过：说清是启动环境带进来的，别叫用户去重启", async () => {
    stub(view({ activeId: "codex-cache" }), { env: { user: "", process: ENV_OLD } })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText(/不是在这里存的/)).toBeTruthy())
    expect(screen.queryByText(/这两个值不一样/)).toBeNull()
  })

  it("「设置里选的」正是指到下面那一份时：不重复列，只在那行写「同时来自」", async () => {
    const payload = view({ activeId: "chosen" })
    stub({
      ...payload,
      chosen: CODEX_ROOT,
      sources: [chosenSource(CODEX_ROOT, "1.0.369"), ...payload.sources]
    })
    render(<PluginCard />)

    await waitFor(() => expect(screen.getByText("Codex 插件缓存")).toBeTruthy())
    // 只剩「自动查找的位置」一张表，指针那一行不再单独出现。
    expect(screen.queryByText("本机指定的位置")).toBeNull()
    expect(screen.getByText("同时来自：设置里选的")).toBeTruthy()
    expect(screen.getAllByText("正在用").length).toBe(1)
  })

  it("自带那一份没装时：给「下载并安装」，点它去装最新那版", async () => {
    const asked: string[] = []
    stub(view({ activeId: "codex-cache" }), {
      update: pluginUpdateFixture({
        state: "update_available",
        local: { version: "", dir: "" },
        available: {
          version: "1.0.370",
          tag: "v1.0.370",
          releasedAt: "2026-10-06T00:00:00.000Z",
          changed: 12,
          removed: 0,
          total: 12,
          checkedAt: "2026-10-06T01:00:00.000Z"
        }
      }),
      onInstall: () => asked.push("install")
    })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("有新版 v1.0.370")).toBeTruthy())
    expect(screen.getByText("远端 v1.0.370，共 12 个文件")).toBeTruthy()

    const install = screen.getByRole("button", { name: "下载并安装" })
    expect(install.hasAttribute("disabled")).toBe(false)
    fireEvent.click(install)
    await waitFor(() => expect(asked).toEqual(["install"]))
  })

  it("自带那一份已是最新时：不给装，说清现在就是这一版", async () => {
    stub(view({ activeId: "codex-cache" }), { update: pluginUpdateFixture() })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("是最新 v1.0.369")).toBeTruthy())
    expect(screen.getByRole("button", { name: "已是最新版" }).hasAttribute("disabled")).toBe(true)
  })

  it("自带那一份装了、但此刻用的不是它：说清去哪一行换过来", async () => {
    stub(view({ activeId: "codex-cache" }), { update: pluginUpdateFixture() })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText(/此刻用的不是这一份/)).toBeTruthy())
  })

  it("正在用的就是自带那一份：直说这一份", async () => {
    const payload = view({ activeId: "install" })
    stub(
      {
        ...payload,
        plugin: { ...payload.plugin, root: INSTALLED_ROOT, version: "1.0.369" },
        sources: payload.sources.map((item) =>
          item.id === "install"
            ? { ...item, exists: true, pluginRoot: INSTALLED_ROOT, version: "1.0.369", found: [INSTALLED_ROOT], active: true }
            : { ...item, active: false }
        )
      },
      { update: pluginUpdateFixture() }
    )
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("正在用的就是这一份。")).toBeTruthy())
  })

  it("检查更新失败时：把后端给的原因照实说出来", async () => {
    stub(view({ activeId: "codex-cache" }), {
      update: pluginUpdateFixture({
        state: "error",
        error: { code: "HTTP_404", message: "下载失败（HTTP 404）", hint: "…/plugin-manifest.json" }
      })
    })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("检查失败")).toBeTruthy())
    expect(screen.getByText(/plugin-manifest\.json/)).toBeTruthy()
  })
})
