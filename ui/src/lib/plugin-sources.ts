import type { PluginSource } from "@/lib/api"

/*
 * 插件来源分两组显示：
 *   本机指定的位置 —— 命令行 --plugin、设置里选的、环境变量（显式指定，优先）
 *   自动查找的位置 —— Codex/Claude 的缓存与市场、客户端自带（客户端按顺序找）
 *
 * 分组按 kind 正向判定：只有 arg/chosen/env 算「本机指定」，其余（含以后新增的自动位置）都归自动查找。
 * 「哪一条正在用」由后端给的 active 标出来，这里不重推顺序 —— 顺序只有 lib/plugin-root.js 一份，
 * 所以文案里也不再重述整条顺序（重述一次就会与后端各走各的）。
 */

export type PluginSourceGroup = { key: string; title: string; hint: string; sources: PluginSource[] }

const EXPLICIT_KINDS = ["arg", "chosen", "env"]

export function groupPluginSources(sources: PluginSource[]): PluginSourceGroup[] {
  const groups: PluginSourceGroup[] = [
    {
      key: "explicit",
      title: "本机指定的位置",
      hint: "命令行 --plugin、设置里选的、环境变量。显式指定优先（--plugin 指错会直接停下）。",
      sources: sources.filter((item) => EXPLICIT_KINDS.includes(item.kind))
    },
    {
      key: "automatic",
      title: "自动查找的位置",
      hint: "客户端自己会找的地方：Codex 缓存与市场、Claude 缓存与市场、客户端自带。",
      sources: sources.filter((item) => !EXPLICIT_KINDS.includes(item.kind))
    }
  ]
  return groups.filter((group) => group.sources.length > 0)
}
