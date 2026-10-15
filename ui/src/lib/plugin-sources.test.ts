import { describe, expect, it } from "vitest"

import type { PluginSource } from "@/lib/api"
import { INSTALL_SLOT_ID, isInstallRow, isOverridden, pluginLookup } from "@/lib/plugin-sources"

/*
 * 来源表的整理规则：同一份插件（同一个插件根）只留一行 —— 最先命中的那一档留下，后面的并进去。
 * 「正在用」是后端标的那一档；它并进前面那一行时，行与顺序条上的 slot 必须同时改，两处不能各说一套。
 */

function source(id: PluginSource["id"], over: Partial<PluginSource> = {}): PluginSource {
  return {
    id: id,
    label: id,
    path: "p/" + id,
    exists: true,
    pluginRoot: "root/" + id,
    version: "1.0.0",
    found: [],
    active: false,
    note: "",
    canOverride: true,
    ...over
  }
}

describe("pluginLookup", () => {
  it("同一份插件只留最先命中的那一行，后面的并进去（名字与 id 都记在行上）", () => {
    const { rows, slots } = pluginLookup([
      source("codex-cache", { label: "Codex 缓存", pluginRoot: "shared" }),
      source("install", { label: "客户端自带", pluginRoot: "shared" })
    ])

    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe("codex-cache")
    expect(rows[0].alsoFrom).toEqual(["客户端自带"])
    expect(rows[0].members).toEqual(["codex-cache", INSTALL_SLOT_ID])
    expect(isInstallRow(rows[0])).toBe(true)
    expect(slots[1].mergedInto).toBe("codex-cache")
    expect(slots[1].mergedIntoOrder).toBe(1)
  })

  it("并进来的那一档是「正在用」时，行与顺序条上留下的那一档同时标上", () => {
    const { rows, slots } = pluginLookup([
      source("codex-cache", { pluginRoot: "shared" }),
      source("install", { pluginRoot: "shared", active: true })
    ])

    expect(rows[0].active).toBe(true)
    expect(slots[0].active).toBe(true)
  })

  it("没被合并时各留一行，每行按自己的档说到哪一份", () => {
    const { rows } = pluginLookup([
      source("codex-cache", { pluginRoot: "a" }),
      source("install", { pluginRoot: "b" })
    ])

    expect(rows.map((row) => row.id)).toEqual(["codex-cache", "install"])
    expect(rows[0].alsoFrom).toEqual([])
  })

  it("切换是不是落在这一行上：看行的成员里有没有那个档 id", () => {
    const { rows } = pluginLookup([source("codex-cache", { pluginRoot: "shared" }), source("install", { pluginRoot: "shared" })])
    expect(isOverridden(rows[0], "install")).toBe(true)
    expect(isOverridden(rows[0], "codex-cache")).toBe(true)
    expect(isOverridden(rows[0], "")).toBe(false)
    expect(isOverridden(rows[0], "claude-cache")).toBe(false)
  })
})
