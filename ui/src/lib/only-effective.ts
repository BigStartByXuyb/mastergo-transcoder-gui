import { hasStored, readStored, writeStored } from "@/lib/storage"

/*
 * 「只看生效」这个开关的记忆：看板与区域页共用一份。
 *
 * 单独一个键，而不是挂在创建任务那张表单上 —— 表单是「怎么建任务」，开关是「怎么看列表」，
 * 混在一起就会出现两个写入入口（一个覆写整条表单、一个读改写）互相盖掉。
 * 更早的版本把这个开关写在创建任务的表单里（键 ...board 的字段），升级后要把它接过来：
 * 读到过的人多半是特意关掉的，静默重置回默认等于把人家藏起来的行又摆回去。
 */

const STORAGE_KEY = "mastergo-transcoder-gui.onlyEffective"
const LEGACY_KEY = "mastergo-transcoder-gui.board"

export function readOnlyEffective(): boolean {
  if (hasStored(STORAGE_KEY)) return readStored(STORAGE_KEY, true, (raw) => raw.value !== false)
  return readStored(LEGACY_KEY, true, (raw) =>
    typeof raw.onlyEffective === "boolean" ? raw.onlyEffective : true
  )
}

export function writeOnlyEffective(value: boolean): void {
  // 包一层是为了过 storage.ts 的「必须是对象」判据：它读出来的东西必须是 JSON 对象。
  writeStored(STORAGE_KEY, { value: value })
}
