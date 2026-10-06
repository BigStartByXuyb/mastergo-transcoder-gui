import type { PluginSource } from "@/lib/api"

/*
 * 插件查找顺序：后端 pluginSources() 给的就是顺序（--plugin → 我选的 → 环境变量 → Codex 缓存/市场 →
 * Claude 缓存/市场 → 客户端自带），这里只做两件事，界面照着渲染，不重排、也不重述顺序：
 *   slots  按查找顺序的每一档（序号 + 这一档的处境）；被合并掉的那几条标出与第几档是同一份
 *   rows   表里的行：解析到同一个插件根时只列一行 —— 留下**最先命中的那一档**（它就是查找停下的地方），
 *          后几档并进它，名字挂 alsoFrom
 *
 * 顺序只有 lib/plugin-root.js 一处；「哪一条正在用」也只有后端给的 active。
 */

export type PluginSourceRow = PluginSource & {
  /** 查找顺序里的第几档（后端给的序号）。 */
  order: number
  /** 与这一行指向同一份插件、被合并掉的来源名（如「客户端自带」）。 */
  alsoFrom: string[]
  /**
   * 这一行代表哪几档（含它自己那一档的 id，按查找顺序）。
   * 用来判断「这一行里有没有客户端自带」——自带的更新动作要能在这一行上做。
   */
  members: string[]
}

export type PluginSourceSlot = PluginSource & {
  order: number
  /** 这一档并进了哪一行（那一行的 id）；它自己就是那一行时是空串。 */
  mergedInto: string
  /** 并进那一行在查找顺序里是第几档；没并进任何一档时是 0。 */
  mergedIntoOrder: number
}

export type PluginLookup = { slots: PluginSourceSlot[]; rows: PluginSourceRow[] }

export function pluginLookup(sources: PluginSource[]): PluginLookup {
  // 「这一档解析出了哪一份插件」只算一次：下面三趟都读它，判据不会各写各的。
  const resolved = sources.map((item, index) => ({
    item: item,
    order: index + 1,
    root: item.exists && item.pluginRoot ? item.pluginRoot : ""
  }))

  // 同一个插件根只留一行：**最先命中的那一档**留下（序号最小），后面的并进它。
  // 它就是「查找停在这里」的那一档，表里的行号与顺序条上的序号因此对得上。
  const keeperOf = new Map<string, string>()
  for (const entry of resolved) {
    if (!entry.root) continue
    if (!keeperOf.has(entry.root)) keeperOf.set(entry.root, entry.item.id)
  }

  // 被合并的来源名挂到留下那一行上；生效标记也跟着并过去（界面仍然只标一处）。
  const extrasOf = new Map<string, string[]>()
  const activeKeepers = new Set<string>()
  const mergedInto = new Map<string, string>()
  for (const entry of resolved) {
    const keeper = entry.root ? keeperOf.get(entry.root) : undefined
    if (!keeper || keeper === entry.item.id) continue
    mergedInto.set(entry.item.id, keeper)
    const list = extrasOf.get(keeper)
    if (list) list.push(entry.item.label)
    else extrasOf.set(keeper, [entry.item.label])
    if (entry.item.active) activeKeepers.add(keeper)
  }

  const memberIdsOf = new Map<string, string[]>()
  for (const entry of resolved) {
    const keeper = entry.root ? keeperOf.get(entry.root) : undefined
    if (!keeper) continue
    const list = memberIdsOf.get(keeper)
    if (list) list.push(entry.item.id)
    else memberIdsOf.set(keeper, [entry.item.id])
  }

  const rows: PluginSourceRow[] = []
  for (const entry of resolved) {
    if (mergedInto.has(entry.item.id)) continue
    rows.push({
      ...entry.item,
      order: entry.order,
      active: entry.item.active || activeKeepers.has(entry.item.id),
      alsoFrom: extrasOf.get(entry.item.id) ?? [],
      members: memberIdsOf.get(entry.item.id) ?? [entry.item.id]
    })
  }

  /*
   * 顺序条与表说的是同一份事实：并进某一档的那几条，状态按留下那一档说
   * （否则会出现「表里标正在用、顺序条上那一档标有」）。
   */
  const rowById = new Map<string, PluginSourceRow>(rows.map((row) => [row.id, row]))
  const slots: PluginSourceSlot[] = resolved.map((entry) => {
    const keeper = mergedInto.get(entry.item.id)
    // 自己就是那一行、或并进了某一档：都取那一行的状态，顺序条与表不会各说一套。
    const kept = rowById.get(keeper ?? entry.item.id)
    return {
      ...entry.item,
      order: entry.order,
      active: kept ? kept.active : entry.item.active,
      exists: kept ? kept.exists : entry.item.exists,
      mergedInto: keeper ?? "",
      mergedIntoOrder: kept && keeper ? kept.order : 0
    }
  })
  return { slots: slots, rows: rows }
}

export type PluginSlotState = "active" | "available" | "missing" | "same"

/** 一档的处境：正在用 / 有 / 没有 / 与前面某一档是同一份（被并掉了）。 */
export function slotState(slot: PluginSourceSlot): PluginSlotState {
  if (slot.mergedInto) return "same"
  if (slot.active) return "active"
  return slot.exists ? "available" : "missing"
}
