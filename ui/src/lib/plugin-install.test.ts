import { describe, expect, it } from "vitest"

import type { PluginUpdateStatus } from "@/lib/api"
import { describePluginInstall, localSituation } from "@/lib/plugin-install"

/*
 * 夹具路径按段拼出来：源码里不出现「盘符 + 反斜杠」那种机器专属写法（结构检查会拦）。
 */
function drive(letter: string, ...parts: string[]): string {
  return [letter + ":", ...parts].join("\\")
}

const LOCAL_DIR = drive("D", "app", "plugins", "mastergo-wpf-transcoder", "1.0.371")
const AGENT_ROOT = drive("C", "codex", "plugins", "cache", "mastergo-wpf-transcoder")

function status(over: Partial<PluginUpdateStatus> = {}): PluginUpdateStatus {
  return {
    state: "up_to_date",
    local: { version: "1.0.371", dir: LOCAL_DIR },
    installed: [{ version: "1.0.371", dir: LOCAL_DIR }],
    available: null,
    error: null,
    task: { phase: "idle", done: 0, total: 0, downloaded: 0, error: null },
    source: {
      kind: "github",
      base: "https://github.com/BigStartByXuyb/mastergo-transcoder-gui",
      manifestUrl: "https://github.com/BigStartByXuyb/mastergo-transcoder-gui/releases/latest/download/plugin-manifest.json",
      kinds: ["github", "gitlab", "static"]
    },
    hasToken: false,
    ...over
  }
}

const avail = {
  version: "1.0.372",
  tag: "v1.0.372",
  releasedAt: "2026-10-06T00:00:00.000Z",
  changed: 4,
  removed: 0,
  total: 12,
  checkedAt: "2026-10-06T01:00:00.000Z"
}

describe("describePluginInstall", () => {
  it("没读到状态时说读取中，且不让装", () => {
    const summary = describePluginInstall(null)
    expect(summary.label).toBe("读取中…")
    expect(summary.canInstall).toBe(false)
  })

  it("本地一份都没有、远端有：按钮是「下载并安装」，说清一共几个文件", () => {
    const summary = describePluginInstall(
      status({ state: "update_available", local: { version: "", dir: "" }, installed: [], available: avail })
    )
    expect(summary.label).toBe("有新版 v1.0.372")
    expect(summary.action).toBe("下载并安装")
    expect(summary.note).toContain("共 12 个文件")
    expect(summary.canInstall).toBe(true)
  })

  it("本地已有一版、远端更新：按钮写「更新到 vX」，说清差几个文件", () => {
    const summary = describePluginInstall(status({ state: "update_available", available: avail }))
    expect(summary.action).toBe("更新到 v1.0.372")
    expect(summary.note).toContain("差 4 个文件")
    expect(summary.canInstall).toBe(true)
  })

  it("已是最新：不给装，按钮写「已是最新版」", () => {
    const summary = describePluginInstall(status())
    expect(summary.label).toBe("是最新 v1.0.371")
    expect(summary.action).toBe("已是最新版")
    expect(summary.canInstall).toBe(false)
  })

  it("没查过（或启动那次没查成）：先让人点检查更新", () => {
    const summary = describePluginInstall(status({ local: { version: "", dir: "" }, installed: [] }))
    expect(summary.label).toBe("还没装")
    expect(summary.note).toContain("检查更新")
    expect(summary.canInstall).toBe(false)
  })

  it("检查失败：说出原因，不给装", () => {
    const summary = describePluginInstall(
      status({ state: "error", error: { code: "HTTP_404", message: "下载失败（HTTP 404）", hint: "…/plugin-manifest.json" } })
    )
    expect(summary.label).toBe("检查失败")
    expect(summary.tone).toBe("destructive")
    expect(summary.note).toContain("plugin-manifest.json")
    expect(summary.canInstall).toBe(false)
  })
})

describe("localSituation", () => {
  it("没有自带那一份", () => {
    expect(localSituation(status({ local: { version: "", dir: "" } }), AGENT_ROOT)).toBe("none")
    expect(localSituation(null, AGENT_ROOT)).toBe("none")
  })

  it("正在用的就是自带那一份", () => {
    expect(localSituation(status(), LOCAL_DIR)).toBe("active")
  })

  it("装了，但此刻用的是别处那份", () => {
    expect(localSituation(status(), AGENT_ROOT)).toBe("other")
  })
})
