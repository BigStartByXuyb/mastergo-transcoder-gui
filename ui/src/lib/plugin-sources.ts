import type { PluginSource } from "@/lib/api"

/*
 * 插件来源分两组显示：
 *   本机指定的位置 —— 命令行 --plugin、设置里选的、环境变量（显式指定，优先）
 *   自动查找的位置 —— Codex/Claude 的缓存与市场、客户端自带（客户端按顺序找）
 *
 * 分组按 kind 正向判定：只有 arg/chosen/env 算「本机指定」，其余（含以后新增的自动位置）都归自动查找。
 * 「哪一条正在用」由后端给的 active 标出来，这里不重推顺序 —— 顺序只有 lib/plugin-root.js 一份，
 * 所以文案里也不再重述整条顺序（重述一次就会与后端各走各的）。
 *
 * 同一份插件只列一行：解析到同一个 pluginRoot 时（例如「设置里选的」正是指到 Codex 缓存里那一份），
 * 合并到**位置那一行**上，并把它原来来自哪儿写在 alsoFrom 里 —— 否则同一个目录会在两张表里各出现一次，
 * 用户看到的是「同一份插件有两条状态」，而不是「一处位置、一条来源」。
 */

export type PluginSourceRow = PluginSource & {
  /** 与这一行指向同一份插件、被合并掉的来源名（如「设置里选的」）。 */
  alsoFrom: string[]
}

export type PluginSourceGroup = { key: string; title: string; hint: string; sources: PluginSourceRow[] }

const EXPLICIT_KINDS = ["arg", "chosen", "env"]

export function groupPluginSources(sources: PluginSource[]): PluginSourceGroup[] {
  const rows = mergeByPluginRoot(sources)
  const groups: PluginSourceGroup[] = [
    {
      key: "explicit",
      title: "本机指定的位置",
      hint: "命令行 --plugin、设置里选的、环境变量。显式指定优先（--plugin 指错会直接停下）。",
      sources: rows.filter((item) => EXPLICIT_KINDS.includes(item.kind))
    },
    {
      key: "automatic",
      title: "自动查找的位置",
      hint: "客户端自己会找的地方：Codex 缓存与市场、Claude 缓存与市场、客户端自带。",
      sources: rows.filter((item) => !EXPLICIT_KINDS.includes(item.kind))
    }
  ]
  return groups.filter((group) => group.sources.length > 0)
}

/*
 * 按解析出的插件根去重。
 *
 * 保留哪一行：**位置那一行**（自动查找里的那条）而不是「本机指定的位置」这类指针 ——
 * 「设置里选的」说的是「我用哪个位置」，位置本身在下面那张表里；指针自己不是一份插件。
 * 没被任何位置覆盖的显式来源（指到别处去了）照常单独一行。
 * 生效标记跟着合并：原来标在指针上的 active 移到留下来的那一行，界面仍然只标一处。
 */
function mergeByPluginRoot(sources: PluginSource[]): PluginSourceRow[] {
  // 同一个插件根只留一行：位置那一条（自动查找）优先，没有位置可归时才留指针那一条。
  const keeperOf = new Map<string, PluginSource>()
  for (const item of sources) {
    if (!item.exists || !item.pluginRoot) continue;
    const current = keeperOf.get(item.pluginRoot)
    if (!current) {
      keeperOf.set(item.pluginRoot, item)
      continue
    }
    if (EXPLICIT_KINDS.includes(current.kind) && !EXPLICIT_KINDS.includes(item.kind)) {
      keeperOf.set(item.pluginRoot, item)
    }
  }

  // 第一遍：留下的各自成行（保持后端给的顺序）。
  const rows: PluginSourceRow[] = []
  const rowByRoot = new Map<string, PluginSourceRow>()
  for (const item of sources) {
    const root = item.exists && item.pluginRoot ? item.pluginRoot : ""
    const keeper = root ? keeperOf.get(root) : undefined
    if (keeper && keeper !== item) continue
    const row: PluginSourceRow = { ...item, alsoFrom: [] }
    rows.push(row)
    if (root) rowByRoot.set(root, row)
  }

  // 第二遍：被合并的，把名字与「正在用」并到留下的那一行上。
  for (const item of sources) {
    const root = item.exists && item.pluginRoot ? item.pluginRoot : ""
    const keeper = root ? keeperOf.get(root) : undefined
    if (!keeper || keeper === item) continue
    const row = rowByRoot.get(root)
    if (!row) continue
    row.alsoFrom.push(item.label)
    if (item.active) row.active = true
  }
  return rows
}
