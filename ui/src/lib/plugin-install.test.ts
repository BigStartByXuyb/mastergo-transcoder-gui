import { describe, expect, it } from "vitest"

import type { PluginUpdateStatus } from "@/lib/api"
import { describePluginInstall } from "@/lib/plugin-install"
import { drive, pluginUpdateFixture, type PluginUpdateOverrides } from "@/lib/settings-fixtures"

const LOCAL_DIR = drive("D", "app", "plugins", "mastergo-wpf-transcoder", "1.0.371")

/* 用例只说自己测的那一格；处境与清单的对齐在夹具那一处（与后端 readState 同一套）。 */
function status(over: PluginUpdateOverrides = {}): PluginUpdateStatus {
  return pluginUpdateFixture({
    local: { version: "1.0.371", dir: LOCAL_DIR },
    ...over
  })
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

// 查过、远端就是本地这一版：说「是最新」要凭这个，不能凭「没查过」。
const availSame = { ...avail, version: "1.0.371", tag: "v1.0.371", changed: 0 }

describe("describePluginInstall", () => {
  it("没读到状态时说读取中，且不让装", () => {
    const summary = describePluginInstall(null)
    expect(summary.label).toBe("读取中…")
    expect(summary.canInstall).toBe(false)
  })

  it("本地一份都没有、远端有：按钮是「下载并安装」，说清一共几个文件", () => {
    const summary = describePluginInstall(
      status({ state: "update_available", local: { version: "", dir: "" }, available: avail })
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
    const summary = describePluginInstall(status({ available: availSame }))
    expect(summary.label).toBe("是最新 v1.0.371")
    expect(summary.action).toBe("已是最新版")
    expect(summary.canInstall).toBe(false)
  })

  it("一次都没查成、本地也没有：说还没装，让人点检查更新", () => {
    const summary = describePluginInstall(status({ local: { version: "", dir: "" }, available: null }))
    expect(summary.label).toBe("还没装")
    expect(summary.note).toContain("检查更新")
    expect(summary.canInstall).toBe(false)
  })

  it("一次都没查成、但本地已装：不能说「是最新」，让人先去查", () => {
    const summary = describePluginInstall(status({ available: null }))
    expect(summary.label).toBe("已装 v1.0.371")
    expect(summary.action).toBe("先检查更新")
    expect(summary.note).toContain("还没检查过远端")
    expect(summary.canInstall).toBe(false)
  })

  it("装了但读不出版本（插件清单里没写版本号）：照实说", () => {
    const summary = describePluginInstall(status({ local: { version: "", dir: LOCAL_DIR }, available: null }))
    expect(summary.label).toBe("已装（读不出版本）")
    expect(summary.canInstall).toBe(false)
  })

  it("装了但读不出版本、远端有清单：按钮写「按远端重装」，不装作没装", () => {
    const summary = describePluginInstall(
      status({ state: "update_available", local: { version: "", dir: LOCAL_DIR }, available: avail })
    )
    expect(summary.action).toBe("按远端重装")
    expect(summary.note).toContain("读不出版本")
    expect(summary.canInstall).toBe(true)
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
