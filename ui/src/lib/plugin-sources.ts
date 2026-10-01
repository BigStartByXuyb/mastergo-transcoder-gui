import type { PluginSource } from "@/lib/api"

/*
 * 插件来源分两组显示：
 *   本机指定的位置 —— 命令行 --plugin、设置里选的、环境变量（显式指定，优先）
 *   自动查找的位置 —— Codex/Claude 的缓存与市场、客户端自带（客户端按顺序找）
 *
 * 「哪一条正在用」由后端给的 active 标出来，这里不重推顺序 —— 顺序只有 lib/plugin-root.js 一份。
 */

export type PluginSourceGroup = { key: string; title: string; hint: string; sources: PluginSource[] }

const AUTOMATIC_KINDS = ["agent", "install"]

export function groupPluginSources(sources: PluginSource[]): PluginSourceGroup[] {
  const list = Array.isArray(sources) ? sources : []
  const groups: PluginSourceGroup[] = [
    {
      key: "explicit",
      title: "本机指定的位置",
      hint: "命令行 --plugin、设置里选的、环境变量。显式指定优先；那一份不在了就往下走。",
      sources: list.filter((item) => !AUTOMATIC_KINDS.includes(item.kind))
    },
    {
      key: "automatic",
      title: "自动查找的位置",
      hint: "客户端自己会找的地方：Codex 缓存与市场、Claude 缓存与市场、客户端自带。",
      sources: list.filter((item) => AUTOMATIC_KINDS.includes(item.kind))
    }
  ]
  return groups.filter((group) => group.sources.length > 0)
}
