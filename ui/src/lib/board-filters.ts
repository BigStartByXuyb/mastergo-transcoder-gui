import type { BoardTask } from "@/lib/api"
import { areaLabel, collectProjectRoots, projectLabel } from "@/lib/areas"
import { readStored, writeStored } from "@/lib/storage"
import { ATTENTION_STATES, FINISHED_STATES, RUNNING_STATES } from "@/lib/task-state"

/*
 * 看板的任务筛选：按工作区（工程目录）、按 UI（区域）、按状态。
 *
 * 任务一多，光看 Target 与模式分不清「这一条是哪个工程、哪个区域的」——
 * 筛选条件与选项都收在这一处，页面只把结论摆出来。条件记在本地，下次打开还在。
 */

const STORAGE_KEY = "mastergo-transcoder-gui.boardFilters"

/*
 * 「未定区域」那一条的过滤值：下拉里 "" 已经用来表示「全部」，不能再当它。
 * （radix 的 SelectItem 也不接受空串作 value，所以这里必须有个名字。）
 */
export const UI_NONE = "__none__"

export type BoardFilters = {
  /** 工程目录；空串＝全部。 */
  projectRoot: string
  /** 区域；空串＝全部。 */
  ui: string
  /** 状态分组的 key（见 STATE_FILTERS）；空串＝全部。 */
  state: string
}

export const EMPTY_BOARD_FILTERS: BoardFilters = { projectRoot: "", ui: "", state: "" }

/*
 * 状态分组按「现在该干什么」分，不按后端的状态名一一列出：
 * 三套状态都取自 lib/task-state.ts 的定义 —— 那边加一个终态，这里跟着变，
 * 不会出现「清掉已结束」认得、筛选的「已结束」不认得这种事。
 */
export const STATE_FILTERS = [
  { key: "attention", label: "要我处理", states: ATTENTION_STATES },
  { key: "running", label: "正在跑", states: RUNNING_STATES },
  { key: "queued", label: "排队中", states: ["queued"] },
  { key: "finished", label: "已结束", states: FINISHED_STATES }
] as const

export function stateGroupOf(key: string): readonly string[] | null {
  const hit = STATE_FILTERS.find((item) => item.key === key)
  return hit ? hit.states : null
}

export function readBoardFilters(): BoardFilters {
  return readStored(STORAGE_KEY, EMPTY_BOARD_FILTERS, (raw) => {
    const state = String(raw.state ?? "")
    return {
      projectRoot: String(raw.projectRoot ?? ""),
      ui: String(raw.ui ?? ""),
      // 认不出来的分组名当没筛：旧版本写进去的 key 不该让列表空掉。
      state: stateGroupOf(state) ? state : ""
    }
  })
}

export function writeBoardFilters(filters: BoardFilters) {
  writeStored(STORAGE_KEY, filters)
}

export function filterTasks(tasks: BoardTask[], filters: BoardFilters): BoardTask[] {
  const states = stateGroupOf(filters.state)
  const wantedUi = filters.ui === UI_NONE ? "" : filters.ui
  const wantedProject = filters.projectRoot.trim()
  return tasks.filter((task) => {
    if (wantedProject && String(task.request?.projectRoot || "").trim() !== wantedProject) return false
    if (filters.ui && String(task.request?.ui || "") !== wantedUi) return false
    if (states && !states.includes(task.state)) return false
    return true
  })
}

/** 有没有在筛：界面上要据此给「清除筛选」，也要在筛空时把话说清楚。 */
export function hasFilters(filters: BoardFilters): boolean {
  return Boolean(filters.projectRoot || filters.ui || filters.state)
}

export type FilterChoice = { value: string; label: string }

/* 选项只从当前这批任务里取：没有任务的工作区不该在下拉里占位。 */
export function filterChoices(tasks: BoardTask[]): { projects: FilterChoice[]; uis: FilterChoice[] } {
  const projects = collectProjectRoots(tasks).map((root) => ({ value: root, label: projectLabel(root) }))
  const uis = [...new Set(tasks.map((task) => String(task.request?.ui || "")))].sort()
  return { projects: projects, uis: uis.map((ui) => ({ value: ui, label: areaLabel(ui) })) }
}
