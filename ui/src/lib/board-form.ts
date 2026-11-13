import { readStored, writeStored } from "@/lib/storage"
import { normalizeStoredMode, type TaskMode } from "@/lib/task-form"

/*
 * 创建任务那张表单的内容：本地记着，下次打开还在。
 * 表单形状与读写只有这一处，看板页与弹窗共用。
 */

const STORAGE_KEY = "mastergo-transcoder-gui.board"

export type BoardTaskForm = {
  projectRoot: string
  ui: string
  mode: TaskMode
  autoMerge: boolean
  overwrite: boolean
  stopAfter: string
  links: string
}

export const EMPTY_BOARD_FORM: BoardTaskForm = {
  projectRoot: "",
  ui: "",
  mode: "A",
  autoMerge: true,
  overwrite: false,
  stopAfter: "",
  links: ""
}

export function readBoardForm(): BoardTaskForm {
  return readStored(STORAGE_KEY, EMPTY_BOARD_FORM, (raw) => ({
    projectRoot: String(raw.projectRoot ?? ""),
    ui: String(raw.ui ?? ""),
    mode: normalizeStoredMode(raw.mode, "A"),
    autoMerge: raw.autoMerge !== false,
    overwrite: raw.overwrite === true,
    stopAfter: String(raw.stopAfter ?? ""),
    links: String(raw.links ?? "")
  }))
}

export function writeBoardForm(form: BoardTaskForm) {
  writeStored(STORAGE_KEY, form)
}
