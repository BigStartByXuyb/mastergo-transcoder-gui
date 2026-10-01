import { describe, expect, it } from "vitest"

import type { PluginSource } from "@/lib/api"
import { groupPluginSources } from "@/lib/plugin-sources"

function source(id: string, kind: PluginSource["kind"], active = false): PluginSource {
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
    active: active
  }
}

describe("插件来源分组", () => {
  it("本机指定的排前面（显式优先），自动查找的在后", () => {
    const groups = groupPluginSources([
      source("codex-cache", "agent"),
      source("chosen", "chosen"),
      source("env", "env"),
      source("install", "install")
    ])
    expect(groups.map((group) => group.key)).toEqual(["explicit", "automatic"])
    expect(groups[0].sources.map((item) => item.id)).toEqual(["chosen", "env"])
    expect(groups[1].sources.map((item) => item.id)).toEqual(["codex-cache", "install"])
  })

  it("没有的那一组不出现（免得摆一个空表）", () => {
    const onlyAuto = groupPluginSources([source("claude-cache", "agent")])
    expect(onlyAuto.map((group) => group.key)).toEqual(["automatic"])
    const onlyExplicit = groupPluginSources([source("chosen", "chosen")])
    expect(onlyExplicit.map((group) => group.key)).toEqual(["explicit"])
    expect(groupPluginSources([])).toEqual([])
  })

  it("组里保留后端给的顺序与 active 标记，不重排", () => {
    const groups = groupPluginSources([
      source("claude-market", "agent"),
      source("codex-cache", "agent", true)
    ])
    expect(groups[0].sources.map((item) => item.id)).toEqual(["claude-market", "codex-cache"])
    expect(groups[0].sources.filter((item) => item.active).map((item) => item.id)).toEqual(["codex-cache"])
  })
})
