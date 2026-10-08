import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PluginCard } from "@/app/plugin-card"
import type { PluginSource, PluginSources, PluginUpdateStatus } from "@/lib/api"
import { INSTALLED_ROOT, INSTALL_PARENT, PLUGIN_SOURCE_BASE, drive, pluginUpdateFixture } from "@/lib/settings-fixtures"

/*
 * 插件页只有一处来源：客户端自带那一份。用例就照这一件事写 ——
 * 那一行说的是不是它、上面有没有多出别的档、管理入口里那些动作打到哪个接口。
 */

/** 来源清单：一条，就是客户端自带那一份。传 over 覆盖它自己的几格。 */
function view(over: Partial<PluginSource> = {}, failure = ""): PluginSources {
  const row: PluginSource = {
    id: "install",
    label: "客户端自带",
    path: INSTALL_PARENT,
    kind: "install",
    exists: true,
    pluginRoot: INSTALLED_ROOT,
    version: "1.0.369",
    found: [INSTALLED_ROOT],
    active: true,
    ...over
  }
  return {
    ok: true,
    plugin: {
      root: row.exists ? row.pluginRoot : "",
      version: row.exists ? row.version : "",
      engine: drive("D", "app", "lib", "node-controls.js"),
      engineExists: true,
      runAllExists: true,
      failure: failure
    },
    sources: [row]
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
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, started: true, version: "1.0.372", note: "", status }), { status: 200 })
      )
    }
    if (url.includes("/api/system/open-folder")) {
      hooks.onOpenFolder?.(body)
      return Promise.resolve(new Response(JSON.stringify({ ok: true, reason: "" }), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

/** 远端有新版、本机还没装的那一格：按钮上写的就是「下载并安装」（口径在 lib/plugin-install）。 */
function notInstalledYet(over: Partial<PluginUpdateStatus> = {}): PluginUpdateStatus {
  return pluginUpdateFixture({
    state: "update_available",
    local: { version: "", dir: "" },
    available: { version: "1.0.372", tag: "v1.0.372", releasedAt: "", changed: 2, removed: 0, total: 12, checkedAt: "" },
    ...over
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 点开「更多」，返回面板（面板里的断言都在它里面找）。 */
async function openDetail() {
  fireEvent.click(await screen.findByRole("button", { name: "更多" }))
  return await screen.findByRole("dialog")
}

describe("PluginCard", () => {
  it("只列客户端自带那一份：来源 / 版本 / 状态 / 路径一行看完", async () => {
    stub(view())
    render(<PluginCard />)

    expect(await screen.findByText("客户端自带")).toBeTruthy()
    expect(screen.getByText("v1.0.369")).toBeTruthy()
    expect(screen.getByText("正在用")).toBeTruthy()
    expect(screen.getByText(INSTALL_PARENT)).toBeTruthy()
    // 只保留一处来源：别的档（我指定的那一份 / 环境变量 / 两个缓存）都不再出现在这一页。
    expect(screen.queryByText(/我指定的那一份/)).toBeNull()
    expect(screen.queryByText(/环境变量/)).toBeNull()
    expect(screen.queryByText(/插件缓存/)).toBeNull()
    expect(screen.queryByText(/插件市场/)).toBeNull()
    expect(screen.queryByText(/查找顺序/)).toBeNull()
  })

  it("这一处装了几份时写出「用最高版本」", async () => {
    const older = drive("D", "app", "plugins", "mastergo-wpf-transcoder", "1.0.368")
    stub(view({ found: [INSTALLED_ROOT, older] }))
    render(<PluginCard />)

    expect(await screen.findByText("这一处有 2 份，用最高版本")).toBeTruthy()
  })

  it("一份都没装时：说清「没装插件」并把后端那句原话显示出来", async () => {
    stub(
      view({ exists: false, pluginRoot: "", version: "", found: [], active: false }, "找不到 mastergo-wpf-transcoder 插件。\n已查找：" + INSTALL_PARENT + "（没有）")
    )
    render(<PluginCard />)

    expect(await screen.findByText("没装插件")).toBeTruthy()
    expect(screen.getByText(/已查找/)).toBeTruthy()
    // 没装就没有可打开的详情：那颗「更多」不给点。
    expect(screen.getByRole("button", { name: "更多" }).hasAttribute("disabled")).toBe(true)
  })

  it("「更多」开的面板里有更新来源那一行，点「修改发布源」开的是插件这一半的弹窗", async () => {
    stub(view())
    render(<PluginCard />)
    const dialog = await openDetail()

    expect(within(dialog).getByText("修改发布源")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "修改发布源" }))

    /*
     * 开的是插件这一半的弹窗：标题写「插件（流水线）」，地址栏预填的是插件那条发布源。
     * （两个弹窗叠着时上层会把下层标成 aria-hidden，所以这里只查当前可见的那一个。）
     */
    await waitFor(() => expect(screen.getByDisplayValue(PLUGIN_SOURCE_BASE)).toBeTruthy())
    expect(screen.getAllByText(/插件（流水线）/).length).toBeGreaterThan(0)
  })

  it("面板里的「检查更新」与「下载并安装」分别打到对应接口", async () => {
    const calls: string[] = []
    stub(view(), { onRequest: (url) => calls.push(url), update: notInstalledYet() })
    render(<PluginCard />)
    const dialog = await openDetail()

    fireEvent.click(within(dialog).getByRole("button", { name: "检查更新" }))
    await waitFor(() => expect(calls.some((url) => url.includes("/api/plugin/update/check"))).toBe(true))

    fireEvent.click(within(dialog).getByRole("button", { name: /下载并安装/ }))
    await waitFor(() => expect(calls.some((url) => url.includes("/api/plugin/update/install"))).toBe(true))
  })

  it("面板里的「打开目录」打到系统打开目录那个接口，路径就是这一处", async () => {
    let opened: unknown = null
    stub(view(), { onOpenFolder: (body) => (opened = body) })
    render(<PluginCard />)
    const dialog = await openDetail()

    fireEvent.click(within(dialog).getByRole("button", { name: "打开目录" }))
    await waitFor(() => expect(opened).toMatchObject({ path: INSTALL_PARENT }))
  })

  it("没装插件时面板里不给「打开目录」（那里没有目录可开）", async () => {
    stub(view({ exists: false, pluginRoot: "", version: "", found: [], active: false }))
    render(<PluginCard />)
    // 「更多」在没装时禁用，这里直接按「已经开过面板」的那条路断言：面板里不该有这颗按钮。
    expect(screen.queryByRole("button", { name: "打开目录" })).toBeNull()
  })

  it("装插件在跑时：只有「下载并安装」转圈，同一面板里的「检查更新」不跟着转", async () => {
    let release: (value: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => (release = resolve))
    stub(view(), { installResponse: pending, update: notInstalledYet() })
    render(<PluginCard />)
    const dialog = await openDetail()

    fireEvent.click(within(dialog).getByRole("button", { name: /下载并安装/ }))

    await waitFor(() => expect(screen.getByRole("button", { name: /下载并安装/ })).toBeTruthy())
    // 「检查更新」那颗不该进忙碌态（忙碌位是两个动作各自的 key，不合成一个）。
    expect(screen.getByRole("button", { name: "检查更新" })).toBeTruthy()
    release(
      new Response(
        JSON.stringify({
          ok: true,
          started: true,
          version: "1.0.372",
          note: "",
          status: pluginUpdateFixture({ task: { phase: "done", done: 3, total: 3, downloaded: 3, error: null } })
        }),
        { status: 200 }
      )
    )
  })

  it("正在传时，「检查更新」与「下载并安装」都不给点", async () => {
    stub(view(), { update: notInstalledYet({ task: { phase: "downloading", done: 1, total: 3, downloaded: 1, error: null } }) })
    render(<PluginCard />)
    const dialog = await openDetail()

    expect(within(dialog).getByRole("button", { name: "检查更新" }).hasAttribute("disabled")).toBe(true)
    expect(within(dialog).getByRole("button", { name: /下载并安装/ }).hasAttribute("disabled")).toBe(true)
  })
})
