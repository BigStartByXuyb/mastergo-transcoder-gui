import { describe, expect, it } from "vitest"

import type { PluginSource } from "@/lib/api"
import { pluginLookup, slotState } from "@/lib/plugin-sources"

function source(id: string, kind: PluginSource["kind"], active = false, over: Partial<PluginSource> = {}): PluginSource {
  const where = "cache/" + id
  return {
    id: id as PluginSource["id"],
    label: id,
    path: where,
    kind: kind,
    exists: true,
    pluginRoot: where,
    version: "1.0.0",
    found: [],
    active: active,
    ...over
  }
}

describe("pluginLookup", () => {
  it("顺序来自后端：slots 与 rows 都按后端给的次序，序号从 1 起", () => {
    const lookup = pluginLookup([
      source("arg", "arg"),
      source("chosen", "chosen"),
      source("codex-cache", "agent"),
      source("install", "install")
    ])
    expect(lookup.slots.map((slot) => slot.id)).toEqual(["arg", "chosen", "codex-cache", "install"])
    expect(lookup.slots.map((slot) => slot.order)).toEqual([1, 2, 3, 4])
    expect(lookup.rows.map((row) => row.id)).toEqual(["arg", "chosen", "codex-cache", "install"])
  })

  it("同一份插件只列一行：留下最先命中的那一档，后几档并进它（含「正在用」）", () => {
    const same = "cache/codex/bigstart/mastergo-wpf-transcoder/1.0.369"
    const lookup = pluginLookup([
      source("chosen", "chosen", true, { pluginRoot: same, label: "我指定的那一份" }),
      source("codex-cache", "agent", false, { pluginRoot: same })
    ])

    expect(lookup.rows.map((row) => row.id)).toEqual(["chosen"])
    expect(lookup.rows[0].active).toBe(true)
    expect(lookup.rows[0].alsoFrom).toEqual(["codex-cache"])
    // 行号就是查找停下的那一档。
    expect(lookup.rows[0].order).toBe(1)
    expect(lookup.slots.map((slot) => slot.mergedInto)).toEqual(["", "chosen"])
    expect(lookup.slots.map((slot) => slot.mergedIntoOrder)).toEqual([0, 1])
    expect(slotState(lookup.slots[1])).toBe("same")
    expect(slotState(lookup.slots[0])).toBe("active")
  })

  it("指到别处去的指针照常单独一行，不受合并影响", () => {
    const lookup = pluginLookup([
      source("chosen", "chosen", true, { pluginRoot: "cache/mine/mastergo-wpf-transcoder" }),
      source("codex-cache", "agent")
    ])
    expect(lookup.rows.map((row) => row.id)).toEqual(["chosen", "codex-cache"])
    expect(lookup.rows[0].alsoFrom).toEqual([])
  })

  it("一档的处境：正在用 / 有 / 没有", () => {
    const lookup = pluginLookup([
      source("chosen", "chosen", true),
      source("env", "env", false, { exists: false, pluginRoot: "", version: "", found: [] }),
      source("install", "install")
    ])
    expect(lookup.slots.map(slotState)).toEqual(["active", "missing", "available"])
  })
})
