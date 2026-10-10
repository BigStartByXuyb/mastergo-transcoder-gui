import type { PluginSource } from "@/lib/api"

/*
 * 插件查找顺序：后端 pluginSources() 给的就是顺序（有几档、每一档见 lib/plugin-root.js 的
 * pluginPlaces() 与 docs/plugin-sources.md），这里只做两件事，界面照着渲染，不重排、也不重述顺序：
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
 * 界面不维护整份 id 词表（那是后端 pluginSources() 的事），只认这一个：它是唯一要分支的档位。
 */
export const INSTALL_SLOT_ID = "install"

/** 显式指定的两档：优先级最高，手动切换盖不过它们，也不给切换入口。 */
const EXPLICIT_SLOT_IDS = ["arg", "env"]


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
      // 并进去的档可能被 override 标成 active：把它归到留下的那一行，避免「正在用」徽章消失。
      if (item.active) keeper.active = true
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

/** 这一行里有没有「客户端自带」那一档（它的管理入口与更新状态都挂在这一行上）。 */
export function isInstallRow(row: Pick<PluginSourceRow, "members">): boolean {
  return row.members.includes(INSTALL_SLOT_ID)
}

/** 这一行能不能手动切换：不含启动参数 / 环境变量那两档（它们由系统那边设）。 */
export function canOverride(row: Pick<PluginSourceRow, "members">): boolean {
  return !row.members.some((id) => EXPLICIT_SLOT_IDS.includes(id))
}

/** 当前手动选择（来源 id）是不是落在这一行上。 */
export function isOverridden(row: Pick<PluginSourceRow, "members">, override: string): boolean {
  return Boolean(override) && row.members.includes(override)
}

