import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PluginCard } from "@/app/plugin-card"
import type { PluginSource, PluginSources, PluginUpdateStatus } from "@/lib/api"
import { INSTALLED_ROOT, INSTALL_PARENT, drive, pluginUpdateFixture } from "@/lib/settings-fixtures"

// 夹具路径按段拼（drive 在 settings-fixtures 里）：源码里不出现「盘符 + 反斜杠」那种机器专属写法。
const CODEX_CACHE = drive("C", "Users", "me", ".codex", "plugins", "cache")
const CODEX_ROOT = drive("C", "Users", "me", ".codex", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder", "1.0.369")
const CLAUDE_CACHE = drive("C", "Users", "me", ".claude", "plugins", "cache")
const CLAUDE_ROOT = drive("C", "Users", "me", ".claude", "plugins", "cache", "bigstart", "mastergo-wpf-transcoder")
const INSTALL_DIR = INSTALL_PARENT
const ENV_OLD = drive("D", "old-plugin")
const MINE_ROOT = drive("D", "mine", "mastergo-wpf-transcoder")

function source(id: PluginSource["id"], over: Partial<PluginSource> = {}): PluginSource {
  return {
    id: id,
    label: id,
    path: "p/" + id,
    kind: "agent",
    exists: false,
    pluginRoot: "",
    version: "",
    found: [],
    active: false,
    ...over
  }
}

// 一台同时装着几份的机器：Codex 缓存（正在用）、Claude 缓存、环境变量指到别处、客户端自带。
// 响应按生产类型写：接口加字段这里就会被 tsc 拦下来。
function view(options: { activeId: string; chosen?: string; failure?: string } = { activeId: "codex-cache" }): PluginSources {
  const sources: PluginSource[] = [
    source("env", {
      label: "环境变量 MASTERGO_PLUGIN_ROOT",
      kind: "env",
      path: ENV_OLD,
      exists: true,
      pluginRoot: MINE_ROOT,
      version: "2.0.0",
      found: [MINE_ROOT],
      active: options.activeId === "env"
    }),
    source("codex-cache", {
      label: "Codex 插件缓存",
      path: CODEX_CACHE,
      exists: true,
      pluginRoot: CODEX_ROOT,
      version: "1.0.369",
      found: [CODEX_ROOT],
      active: options.activeId === "codex-cache"
    }),
    source("claude-cache", {
      label: "Claude 插件缓存",
      path: CLAUDE_CACHE,
      exists: true,
      pluginRoot: CLAUDE_ROOT,
      version: "1.0.245",
      found: ["a", "b", "c", "d"],
      active: options.activeId === "claude-cache"
    }),
    source("install", {
      label: "客户端自带",
      kind: "install",
      path: INSTALL_DIR,
      exists: true,
      pluginRoot: INSTALLED_ROOT,
      version: "1.0.369",
      found: [INSTALLED_ROOT],
      active: options.activeId === "install"
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
    chosen: options.chosen ?? "",
    sources: sources
  }
}

function stub(
  payload: PluginSources,
  hooks: {
    update?: PluginUpdateStatus
    onChoose?: (body: unknown) => void
    onInstall?: () => void
    onCheck?: () => void
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
    if (url.includes("/api/plugin/choose")) {
      hooks.onChoose?.(body)
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
    }
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("PluginCard", () => {
  it("一张表列全部来源：顺序来自后端，正在用的只标一处", async () => {
    stub(view())
    render(<PluginCard />)
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Codex 插件缓存")).toBeTruthy())

    // 四档都在同一张表里（没有按「本机指定 / 自动查找」拆两张），左边带顺序号。
    const table = within(screen.getByRole("table"))
    expect(table.getByText("环境变量 MASTERGO_PLUGIN_ROOT")).toBeTruthy()
    expect(table.getByText("Claude 插件缓存")).toBeTruthy()
    expect(table.getByText("客户端自带")).toBeTruthy()
    expect(screen.getAllByText("正在用").length).toBe(1)
    // 有插件又不在用的那几档给「用这份」。
    expect(screen.getAllByRole("button", { name: "用这份" }).length).toBe(3)
  })

  it("顺序条把每一档的处境写出来，同一份插件只算一次", async () => {
    stub(view({ activeId: "codex-cache" }))
    render(<PluginCard />)
    // 顺序条上那一档写清处境（可访问名里子元素之间会有空格）。
    await waitFor(() => expect(screen.getByRole("button", { name: /Codex 插件缓存\s*（正在用）/ })).toBeTruthy())

    // 环境变量那份、Claude 那份、自带那份都不是「正在用」：各写各的「可用」（与表里那颗徽章同一处措辞）。
    expect(screen.getAllByText("（可用）").length).toBe(3)
  })

  it("「我指定的那一份」指到某一份时：只列最先命中的那一档，后几档并进它", async () => {
    stub({
      ...view({ activeId: "codex-cache" }),
      chosen: CODEX_ROOT,
      sources: [
        source("chosen", {
          label: "我指定的那一份",
          kind: "chosen",
          path: CODEX_ROOT,
          exists: true,
          pluginRoot: CODEX_ROOT,
          version: "1.0.369",
          found: [CODEX_ROOT],
          active: true
        }),
        ...view({ activeId: "codex-cache" }).sources
      ]
    })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("同时来自：Codex 插件缓存")).toBeTruthy())
    // 留下的是最先命中的那一档（1. 我指定的那一份），Codex 缓存不再单独占一行。
    const table = within(screen.getByRole("table"))
    expect(table.getByText("我指定的那一份")).toBeTruthy()
    expect(table.queryByText("Codex 插件缓存")).toBeNull()
  })

  it("自带那一行写着它自己的更新状态，点「管理…」开面板", async () => {
    stub(view(), {
      update: pluginUpdateFixture({
        state: "update_available",
        local: { version: "1.0.369", dir: INSTALLED_ROOT },
        available: {
          version: "1.0.372",
          tag: "v1.0.372",
          releasedAt: "2026-10-06T00:00:00.000Z",
          changed: 4,
          removed: 0,
          total: 12,
          checkedAt: "2026-10-06T01:00:00.000Z"
        }
      })
    })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("有新版 v1.0.372")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "管理…" }))
    // 面板里是这一档的详情 + 两个动作。
    expect(await screen.findByRole("button", { name: "检查更新" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "更新到 v1.0.372" })).toBeTruthy()
    expect(screen.getByText(/查找顺序里的第 4 档/)).toBeTruthy()
  })

  it("指定的那一份正好是客户端自带那份时：合成一行，管理入口也在这一行上", async () => {
    const installSources = view({ activeId: "install" }).sources
    stub({
      ...view({ activeId: "install" }),
      chosen: INSTALLED_ROOT,
      sources: [
        source("chosen", {
          label: "我指定的那一份",
          kind: "chosen",
          path: INSTALLED_ROOT,
          exists: true,
          pluginRoot: INSTALLED_ROOT,
          version: "1.0.369",
          found: [INSTALLED_ROOT],
          active: true
        }),
        ...installSources
      ]
    })
    render(<PluginCard />)
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("同时来自：客户端自带")).toBeTruthy())

    // 合成的那一行给的是「管理…」，面板里带自带的更新块。
    const row = within(screen.getByRole("table")).getByText("我指定的那一份").closest("tr") as HTMLElement
    fireEvent.click(within(row).getByRole("button", { name: "管理…" }))
    expect(await screen.findByRole("button", { name: "检查更新" })).toBeTruthy()
    expect(screen.getByText(/同时也是「客户端自带」那一份/)).toBeTruthy()
  })

  it("面板里的「下载并安装」「打开目录」分别打到对应接口", async () => {
    const asked: string[] = []
    stub(view(), {
      update: pluginUpdateFixture({
        state: "update_available",
        local: { version: "", dir: "" },
        available: {
          version: "1.0.372",
          tag: "v1.0.372",
          releasedAt: "2026-10-06T00:00:00.000Z",
          changed: 12,
          removed: 0,
          total: 12,
          checkedAt: "2026-10-06T01:00:00.000Z"
        }
      }),
      onInstall: () => asked.push("install"),
      onOpenFolder: (body) => asked.push("open:" + JSON.stringify(body))
    })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("有新版 v1.0.372")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "管理…" }))

    fireEvent.click(await screen.findByRole("button", { name: "打开目录" }))
    await waitFor(() => expect(asked.some((item) => item.startsWith("open:"))).toBe(true))
    const opened = asked.find((item) => item.startsWith("open:")) ?? ""
    expect(JSON.parse(opened.replace(/^open:/, "")).path).toBe(INSTALL_DIR)

    fireEvent.click(screen.getByRole("button", { name: "下载并安装" }))
    await waitFor(() => expect(asked).toContain("install"))
  })

  it("点别的行开的是详情：只读信息 + 「用这份」", async () => {
    const chosen: unknown[] = []
    stub(view(), { onChoose: (body) => chosen.push(body) })
    render(<PluginCard />)
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Claude 插件缓存")).toBeTruthy())

    // 点 Claude 那一行的「详情…」（它有 4 份，正好看「这一处有几份」）；只在表里找，别挑到上面顺序条。
    const claudeRow = within(screen.getByRole("table")).getByText("Claude 插件缓存").closest("tr") as HTMLElement
    fireEvent.click(within(claudeRow).getByRole("button", { name: "详情…" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("这一档")).toBeTruthy()
    expect(within(dialog).getByText("这一处有 4 份，用最高版本")).toBeTruthy()
    // 面板里不该出现「当文本渲染出来的注释」（JSX 里漏了 {} 的块注释就会这样）。
    expect(dialog.textContent ?? "").not.toContain("/*")

    fireEvent.click(within(dialog).getByRole("button", { name: "用这份" }))
    await waitFor(() => expect(chosen.length).toBe(1))
    // 记的是这一档所在的目录（不是此刻那一个版本目录）：以后装了新版本才会跟着取最高版本。
    expect(chosen[0]).toMatchObject({ path: CLAUDE_CACHE })
  })

  it("「我指定的那一份」的两个动作就在表里那一行上：已指定＝换个目录… + 交给客户端找", async () => {
    const chosen: unknown[] = []
    const base = view()
    stub(
      {
        ...base,
        chosen: MINE_ROOT,
        sources: [
          source("chosen", {
            label: "我指定的那一份",
            kind: "chosen",
            path: MINE_ROOT,
            exists: true,
            pluginRoot: MINE_ROOT,
            version: "2.0.0",
            found: [MINE_ROOT]
          }),
          ...base.sources
        ]
      },
      { onChoose: (body) => chosen.push(body) }
    )
    render(<PluginCard />)
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("我指定的那一份")).toBeTruthy())

    // 页面顶层不再另占一块：两个动作就在承载这一档的那一行上。
    const row = within(screen.getByRole("table")).getByText("我指定的那一份").closest("tr") as HTMLElement
    expect(within(row).getByRole("button", { name: "换个目录…" })).toBeTruthy()
    fireEvent.click(within(row).getByRole("button", { name: "交给客户端找" }))
    await waitFor(() => expect(chosen.length).toBe(1))
    expect(chosen[0]).toMatchObject({ path: "" })
  })

  it("没指定时那一行给的是「指定一个目录…」，并说清按顺序往下找", async () => {
    const base = view()
    stub({
      ...base,
      chosen: "",
      sources: [
        // 后端的八档里，没设的那几档也列出来（路径为空、标「没有」）。
        source("chosen", { label: "我指定的那一份", kind: "chosen", path: "", exists: false }),
        ...base.sources
      ]
    })
    render(<PluginCard />)
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("我指定的那一份")).toBeTruthy())

    const row = within(screen.getByRole("table")).getByText("我指定的那一份").closest("tr") as HTMLElement
    expect(within(row).getByRole("button", { name: "指定一个目录…" })).toBeTruthy()
    // 没指定时「交给客户端找」没有对象可清。
    expect((within(row).getByRole("button", { name: "交给客户端找" }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(row).getByText(/没指定：按这个顺序往下找/)).toBeTruthy()
  })

  it("指定的那一份没在生效时：只留换目录 / 交给客户端找，不再给那颗空操作的「用这份」", async () => {
    const base = view({ activeId: "codex-cache" })
    stub({
      ...base,
      chosen: CLAUDE_ROOT,
      sources: [
        // 顺序上这一档在前（与生产一致：--plugin → 我指定的 → …），它指到 Claude 缓存那一份。
        source("chosen", {
          label: "我指定的那一份",
          kind: "chosen",
          path: CLAUDE_ROOT,
          exists: true,
          pluginRoot: CLAUDE_ROOT,
          version: "1.0.245",
          found: [CLAUDE_ROOT]
        }),
        ...base.sources
      ]
    })
    render(<PluginCard />)
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("我指定的那一份")).toBeTruthy())

    const row = within(screen.getByRole("table")).getByText("我指定的那一份").closest("tr") as HTMLElement
    // 生效的是 Codex 缓存（第 4 档），而「用这份」记的就是这一行自己：那颗是空操作，不给。
    expect(within(row).queryByRole("button", { name: "用这份" })).toBeNull()
    expect(within(row).getByRole("button", { name: "换个目录…" })).toBeTruthy()
    expect(within(row).getByRole("button", { name: "交给客户端找" })).toBeTruthy()
  })

  it("一处都没找到时把后端列出来的已查找路径原样显示", async () => {
    stub(view({ activeId: "", failure: "找不到 mastergo-wpf-transcoder 插件。\n已查找：" + INSTALL_DIR + "（没有）" }))
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("没找到插件")).toBeTruthy())
    expect(screen.getByText(new RegExp("已查找：" + INSTALL_DIR.replace(/\\/g, "\\\\") + "（没有）"))).toBeTruthy()
  })

  it("「更新来源」在自带那一行的管理面板里（页面顶层不再占一块），点「修改发布源」开的是插件这一半的弹窗", async () => {
    const asked: string[] = []
    stub(view(), { onCheck: () => asked.push("check"), onRequest: (url) => asked.push("req:" + url) })
    render(<PluginCard />)
    // 顶层的那些动作（更新来源 / 检查更新）都收进了自带那一行的管理面板：页面上先找不到它们。
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("客户端自带")).toBeTruthy())
    expect(screen.queryByText("更新来源")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "管理…" }))
    const panel = await screen.findByRole("dialog")
    // 面板里才看得见「从哪儿取」：类型 + 地址（与「程序更新」那一侧是同一处设置）。
    expect(within(panel).getByText("更新来源")).toBeTruthy()
    expect(within(panel).getByText(pluginUpdateFixture().source.base)).toBeTruthy()

    fireEvent.click(within(panel).getByRole("button", { name: "修改发布源" }))
    // 这时页面上有两个弹窗（管理面板 + 改发布源），按标题取那一个。
    const title = await screen.findByText("修改发布源 · 插件（流水线）")
    const dialog = title.closest('[role="dialog"]') as HTMLElement
    expect((within(dialog).getByLabelText("地址") as HTMLInputElement).value).toBe(pluginUpdateFixture().source.base)

    // 保存并检查：先存这一处设置，再按插件那份清单验一次（不是程序更新那条）。
    fireEvent.click(within(dialog).getByRole("button", { name: "保存并检查" }))
    await waitFor(() => expect(asked).toContain("check"))
    expect(asked.some((item) => item.includes("/api/settings"))).toBe(true)
  })

  it("「检查更新」在自带那一行的管理面板里，打到插件那条接口", async () => {
    let checks = 0
    stub(view(), { onCheck: () => (checks += 1) })
    render(<PluginCard />)
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("客户端自带")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "管理…" }))
    const panel = await screen.findByRole("dialog")

    fireEvent.click(within(panel).getByRole("button", { name: "检查更新" }))
    await waitFor(() => expect(checks).toBe(1))
  })

  it("自带那一行的「用这份」记的是那一处目录，不是当前那个版本目录", async () => {
    const chosen: unknown[] = []
    stub(view({ activeId: "codex-cache" }), { onChoose: (body) => chosen.push(body) })
    render(<PluginCard />)
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("客户端自带")).toBeTruthy())

    // 记版本目录的话，客户端自带那份装完新版（版本目录换了名）就不会再生效。
    const installRow = within(screen.getByRole("table")).getByText("客户端自带").closest("tr") as HTMLElement
    fireEvent.click(within(installRow).getByRole("button", { name: "用这份" }))
    await waitFor(() => expect(chosen.length).toBe(1))
    expect(chosen[0]).toMatchObject({ path: INSTALL_DIR })
  })

  it("详情面板里「没有」的那一档不给「打开目录」（那里没有目录可开）", async () => {
    const market = drive("C", "Users", "me", ".codex", "plugins", "marketplaces")
    stub({
      ...view(),
      sources: [
        ...view().sources,
        source("codex-market", { label: "Codex 插件市场", path: market, exists: false })
      ]
    })
    render(<PluginCard />)
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("Codex 插件市场")).toBeTruthy())
    const row = within(screen.getByRole("table")).getByText("Codex 插件市场").closest("tr") as HTMLElement
    fireEvent.click(within(row).getByRole("button", { name: "详情…" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByRole("button", { name: "打开目录" })).toBeNull()
    // 路径本身还能复制（这一档没设时它连路径都没有，那是另一回事）。
    expect(within(dialog).getByRole("button", { name: "复制路径" })).toBeTruthy()
  })

  it("装插件在跑时：只有「下载并安装」转圈，同一行的「用这份」不跟着转", async () => {
    // 装这一版要等一会：卡住这个请求，让「正在装」那一瞬间停在界面上。
    let release: (value: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    stub(view(), {
      installResponse: pending,
      update: pluginUpdateFixture({
        state: "update_available",
        local: { version: "", dir: "" },
        available: {
          version: "1.0.372",
          tag: "v1.0.372",
          releasedAt: "2026-10-06T00:00:00.000Z",
          changed: 12,
          removed: 0,
          total: 12,
          checkedAt: "2026-10-06T01:00:00.000Z"
        }
      })
    })
    render(<PluginCard />)
    await waitFor(() => expect(screen.getByText("有新版 v1.0.372")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "管理…" }))
    const dialog = await screen.findByRole("dialog")

    /*
     * 面板里「客户端自带」那一行的 id 也叫 install，自带的更新动作 key 也是 install。
     * 两半各报各的忙碌位（来源清单那一半 / 自带那半），所以只有装那颗按钮进忙碌态
     * （aria-busy 就是这个意思，也顺带给读屏软件说一声）。
     */
    fireEvent.click(within(dialog).getByRole("button", { name: "下载并安装" }))
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "下载并安装" }).getAttribute("aria-busy")).toBe("true")
    )
    expect(within(dialog).getByRole("button", { name: "用这份" }).getAttribute("aria-busy")).toBe("false")
    release(new Response(JSON.stringify({ ok: true, started: true, version: "1.0.372", note: "", status: pluginUpdateFixture() }), { status: 200 }))
  })

  it("正在传时，自带那一行的管理面板里「检查更新」与「下载并安装」都不给点", async () => {
    stub(
      view(),
      {
        update: pluginUpdateFixture({
          state: "update_available",
          available: {
            version: "1.0.372",
            tag: "v1.0.372",
            releasedAt: "2026-10-06T00:00:00.000Z",
            changed: 4,
            removed: 0,
            total: 12,
            checkedAt: "2026-10-06T01:00:00.000Z"
          },
          task: { phase: "downloading", done: 3, total: 12, downloaded: 3, error: null }
        })
      }
    )
    render(<PluginCard />)
    // 顶层没有这颗按钮了（它只在管理面板里）。
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("客户端自带")).toBeTruthy())
    expect(screen.queryByRole("button", { name: "检查更新" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "管理…" }))
    const dialog = await screen.findByRole("dialog")
    const check = within(dialog).getByRole("button", { name: "检查更新" })
    expect((check as HTMLButtonElement).disabled).toBe(true)
    const install = within(dialog).getByRole("button", { name: /下载并安装|更新到 v|按远端重装/ })
    expect((install as HTMLButtonElement).disabled).toBe(true)
  })
})
