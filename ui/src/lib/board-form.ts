import { readStored, writeStored } from "@/lib/storage"

/*
 * 创建任务那张表单的内容：本地记着，下次打开还在。
 * 表单形状与读写只有这一处，看板页与弹窗共用。
 */

const STORAGE_KEY = "mastergo-transcoder-gui.board"

export type BoardTaskForm = {
  projectRoot: string
  ui: string
  mode: "A" | "B" | "AB"
  autoMerge: boolean
  overwrite: boolean
  stopAfter: string
  links: string
  /** 只看当前生效的任务：被后一次合并覆盖的默认藏起来。 */
  onlyEffective: boolean
}

export const EMPTY_BOARD_FORM: BoardTaskForm = {
  projectRoot: "",
  ui: "",
  mode: "B",
  autoMerge: true,
  overwrite: false,
  stopAfter: "",
  links: "",
  onlyEffective: true
}

export function readBoardForm(): BoardTaskForm {
  return readStored(STORAGE_KEY, EMPTY_BOARD_FORM, (raw) => ({
    projectRoot: String(raw.projectRoot ?? ""),
    ui: String(raw.ui ?? ""),
    mode: raw.mode === "A" || raw.mode === "AB" ? raw.mode : "B",
    autoMerge: raw.autoMerge !== false,
    overwrite: raw.overwrite === true,
    stopAfter: String(raw.stopAfter ?? ""),
    links: String(raw.links ?? ""),
    onlyEffective: raw.onlyEffective !== false
  }))
}

export function writeBoardForm(form: BoardTaskForm) {
  writeStored(STORAGE_KEY, form)
}

/*
 * 「只看生效」这个开关看板与区域页共用一份记忆：区域页只动它，不动创建任务那张表单。
 * （读改写走同一份校验与同一个键，两页的默认值不会分叉。）
 */
export function readOnlyEffective(): boolean {
  return readBoardForm().onlyEffective
}

export function writeOnlyEffective(value: boolean) {
  writeBoardForm({ ...readBoardForm(), onlyEffective: value })
}
