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

/**
 * 「客户端自带」那一档的 id（后端 lib/plugin-root.js 给的 id 就是它）。
 * 这一档在这一页有几处判断（这一行里有没有它、它自己是哪一档），都读这一处，不再各写一个 "install"。
 */
export const INSTALL_SLOT_ID: PluginSource["id"] = "install"

/** 「我指定的那一份」那一档的 id（后端给的就是它）：顶栏那块按它取这一档的处境。 */
export const CHOSEN_SLOT_ID: PluginSource["id"] = "chosen"

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

  /*
   * 留一行、其余的并进去：这一趟同时收三样 —— 谁并进了谁（mergedInto）、留下那一行的「同时来自」
   * （extrasOf，用名字给界面看）、以及这一行代表哪几档（memberIdsOf，用 id 判断「这一行有没有自带那一档」）。
   * 「正在用」不用另并一次：后端只在真正生效的那一档上标 active，而那一档必定就是它那个插件根的
   * 最先命中者（＝留下的那一行），所以被并掉的那几档本来就不会带 active。
   */
  const mergedInto = new Map<string, string>()
  const extrasOf = new Map<string, string[]>()
  const memberIdsOf = new Map<string, string[]>()
  for (const entry of resolved) {
    const keeper = entry.root ? keeperOf.get(entry.root) : undefined
    if (!keeper) continue
    // 每一档都算这一行的成员（含它自己）；被并掉的另外记一笔，名字挂给留下那一行。
    memberIdsOf.set(keeper, (memberIdsOf.get(keeper) ?? []).concat(entry.item.id))
    if (keeper === entry.item.id) continue
    mergedInto.set(entry.item.id, keeper)
    extrasOf.set(keeper, (extrasOf.get(keeper) ?? []).concat(entry.item.label))
  }

  const rows: PluginSourceRow[] = []
  for (const entry of resolved) {
    if (mergedInto.has(entry.item.id)) continue
    rows.push({
      ...entry.item,
      order: entry.order,
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

/*
 * 「换用这一档」这件事的两条判据只有这一处：给不给换（表里那一行与点开的面板都读它）、
 * 换了记哪个目录。记的是这一档**所在的目录**（不是此刻解析到的那一个版本目录）——
 * 定位认「指到插件根、或指到装着它的目录」两种，记目录才会在装了新版本后跟着取最高版本；
 * 记死版本目录的话，客户端自带那份装完新版反而不生效。
 */
export function canChooseThis(row: Pick<PluginSource, "exists" | "active">): boolean {
  return Boolean(row.exists && !row.active)
}

export function choosePathOf(row: Pick<PluginSource, "path" | "pluginRoot">): string {
  return row.path || row.pluginRoot
}

/*
 * 插件页「哪个动作在跑」的 key 只有这一处：忙碌位是一个字符串，写（hook）与读（组件）都从这里取，
 * 改名不会漏。来源清单那一半有自己的三把（读清单 / 选目录 / 交回自动），自带那一半有 check / install；
 * 「用这份」那把就是那一行的 id（chooseKeyOf）。
 */
export const PLUGIN_BUSY = {
  load: "load",
  pick: "pick",
  auto: "auto",
  check: "check",
  install: "install"
} as const

/** 「用这份」的忙碌位 key：就是那一行的 id（写与比对都读这一处）。 */
export function chooseKeyOf(row: Pick<PluginSource, "id">): string {
  return row.id
}
