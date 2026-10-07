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

/** 「我指定的那一份」那一档的 id（后端给的就是它）：只在本模块里用，认它请走 ownsChosenSlot。 */
const CHOSEN_SLOT_ID: PluginSource["id"] = "chosen"

/**
 * 这一行是不是承载「我指定的那一份」那一档（那一档的指针动作与没设时那句话挂在它这一行上）。
 * 没设时这一档也有自己一行（路径空、标「没有」）：行组件不自己判 id，读这一处。
 */
export function ownsChosenSlot(row: Pick<PluginSourceRow, "members">): boolean {
  return row.members.includes(CHOSEN_SLOT_ID)
}

export type PluginSourceSlot = PluginSource & {
  order: number
  /** 这一档并进了哪一行（那一行的 id）；它自己就是那一行时是空串。 */
  mergedInto: string
  /** 并进那一行在查找顺序里是第几档；没并进任何一档时是 0。 */
  mergedIntoOrder: number
}

export type PluginLookup = { slots: PluginSourceSlot[]; rows: PluginSourceRow[] }

/*
 * 一趟扫完：每一档当场决定「留下」还是「并进前面那一档」，两样结果都当场写出来。
 *
 *   同一份插件（同一个插件根）只留一行 —— 最先命中的那一档留下（序号最小），它就是「查找停在这里」的
 *   那一档，表里的行号与顺序条上的序号因此对得上；后面命中的并进去，名字挂 alsoFrom、id 进 members。
 *
 * 「正在用」不用另算：后端只在真正生效的那一档上标 active，而那一档必定是它那个插件根的最先命中者
 * （＝留下的那一行），所以并进去的那几档本来就不带 active —— 它们的处境按留下那一行说。
 */
export function pluginLookup(sources: PluginSource[]): PluginLookup {
  const rows: PluginSourceRow[] = []
  const slots: PluginSourceSlot[] = []
  // 插件根 → 留下的那一行：只有这一张表要维护。
  const keeperOf = new Map<string, PluginSourceRow>()

  sources.forEach(function (item, index) {
    const order = index + 1
    const root = item.exists && item.pluginRoot ? item.pluginRoot : ""
    const keeper = root ? keeperOf.get(root) : undefined
    if (keeper) {
      keeper.alsoFrom.push(item.label)
      keeper.members.push(item.id)
      // 并进去的：处境按留下那一行说，顺序条与表不会各说一套。
      slots.push({
        ...item,
        order: order,
        active: keeper.active,
        exists: keeper.exists,
        mergedInto: keeper.id,
        mergedIntoOrder: keeper.order
      })
      return
    }
    const row: PluginSourceRow = { ...item, order: order, alsoFrom: [], members: [item.id] }
    if (root) keeperOf.set(root, row)
    rows.push(row)
    slots.push({ ...item, order: order, mergedInto: "", mergedIntoOrder: 0 })
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
 *
 * 承载「我指定的那一份」的那一行不给「用这份」：那一行的指针本来就是这一份（再记一次是空操作，
 * 还会弹一句「已换用这一份」），要换只能换目录 —— 那一行给的是「换个目录…／交给客户端找」。
 */
export function canChooseThis(row: Pick<PluginSourceRow, "exists" | "active" | "members">): boolean {
  return Boolean(row.exists && !row.active && !ownsChosenSlot(row))
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
  // 自带那一半的两把带 update: 前缀：与「这一行的 id 就是忙碌位」那条规则的取值不重叠
  // （客户端自带那一行的 id 也叫 install），将来把两半的 busy 摆错地方也不会误命中。
  check: "update:check",
  install: "update:install"
} as const

/** 「用这份」的忙碌位 key：就是那一行的 id（写与比对都读这一处）。 */
export function chooseKeyOf(row: Pick<PluginSource, "id">): string {
  return row.id
}

/** 这一行里有没有「客户端自带」那一档（它的管理入口与更新状态都挂在这一行上）。 */
export function isInstallRow(row: Pick<PluginSourceRow, "members">): boolean {
  return row.members.includes(INSTALL_SLOT_ID)
}
