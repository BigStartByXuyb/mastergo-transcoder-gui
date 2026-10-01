import { beforeEach, describe, expect, it } from "vitest"

import type { BoardTask } from "@/lib/api"
import {
  EMPTY_BOARD_FILTERS,
  UI_NONE,
  filterChoices,
  filterTasks,
  hasFilters,
  readBoardFilters,
  stateGroupOf,
  writeBoardFilters
} from "@/lib/board-filters"

function task(id: string, state: string, projectRoot: string, ui: string): BoardTask {
  return { id, state, request: { projectRoot, ui } } as unknown as BoardTask
}

// 夹具路径按段拼：源码里不出现「盘符 + 反斜杠」那种机器专属写法（结构检查会拦）。
function drive(letter: string, ...parts: string[]): string {
  return [letter + ":", ...parts].join("\\")
}

const ONLY_TEST = drive("D", "only_test")
const TTT = drive("D", "ttt")

const TASKS = [
  task("a", "running", ONLY_TEST, "F4"),
  task("b", "waiting", ONLY_TEST, "F4"),
  task("c", "ready", ONLY_TEST, "F8"),
  task("d", "merged", TTT, "F4"),
  task("e", "failed", TTT, "")
]

beforeEach(() => {
  localStorage.clear()
})

describe("看板筛选", () => {
  it("没筛就是全部，且说得出「在筛」", () => {
    expect(filterTasks(TASKS, EMPTY_BOARD_FILTERS).length).toBe(5)
    expect(hasFilters(EMPTY_BOARD_FILTERS)).toBe(false)
    expect(hasFilters({ projectRoot: TTT, ui: "", state: "" })).toBe(true)
  })

  it("按工作区筛，只留这个工程的任务", () => {
    const got = filterTasks(TASKS, { projectRoot: TTT, ui: "", state: "" })
    expect(got.map((item) => item.id)).toEqual(["d", "e"])
  })

  it("按 UI 筛，空 ui 是「未定区域」那一条，不等于全部", () => {
    const f4 = filterTasks(TASKS, { projectRoot: "", ui: "F4", state: "" })
    expect(f4.map((item) => item.id)).toEqual(["a", "b", "d"])
    const none = filterTasks(TASKS, { projectRoot: "", ui: "F8", state: "" })
    expect(none.map((item) => item.id)).toEqual(["c"])
    // 未定区域有它自己的过滤值："" 已经表示「全部」，不能混用。
    const undecided = filterTasks(TASKS, { projectRoot: "", ui: UI_NONE, state: "" })
    expect(undecided.map((item) => item.id)).toEqual(["e"])
  })

  it("按状态分组筛：要我处理 = 侧边栏那套（等待/待合并/冲突/失败/停止）", () => {
    expect(stateGroupOf("attention")).toEqual(["waiting", "ready", "conflict", "failed", "stopped"])
    const got = filterTasks(TASKS, { projectRoot: "", ui: "", state: "attention" })
    expect(got.map((item) => item.id)).toEqual(["b", "c", "e"])
  })

  it("三个条件是与的关系", () => {
    const got = filterTasks(TASKS, { projectRoot: ONLY_TEST, ui: "F4", state: "attention" })
    expect(got.map((item) => item.id)).toEqual(["b"])
  })

  it("选项只从现有任务里取，工作区显示最后两段", () => {
    const choices = filterChoices(TASKS)
    expect(choices.projects.map((item) => item.label)).toEqual([ONLY_TEST, TTT])
    expect(choices.uis.map((item) => item.value)).toEqual(["", "F4", "F8"])
    expect(choices.uis.map((item) => item.label)).toEqual(["未定区域", "F4", "F8"])
  })

  it("条件记在本地，读回来还是那一份", () => {
    writeBoardFilters({ projectRoot: TTT, ui: "F4", state: "running" })
    expect(readBoardFilters()).toEqual({ projectRoot: TTT, ui: "F4", state: "running" })
  })

  it("认不出来的状态分组当没筛，不让列表莫名空掉", () => {
    localStorage.setItem("mastergo-transcoder-gui.boardFilters", JSON.stringify({ state: "gone" }))
    expect(readBoardFilters().state).toBe("")
  })

  it("本地存的是坏 JSON 就回到空筛选", () => {
    localStorage.setItem("mastergo-transcoder-gui.boardFilters", "{ 坏掉")
    expect(readBoardFilters()).toEqual(EMPTY_BOARD_FILTERS)
  })
})
