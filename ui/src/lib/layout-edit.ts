import type { DerivedLayout, LayoutCell, LayoutControl, LayoutGroup, LayoutRegion } from "@/lib/api"

/*
 * 布局确认面板的两件纯逻辑：控件编号（人对编号说话，分组表里存 ref）与分组的增删改。
 *
 * 这里只做「人怎么改」这件事，不做「表合不合法」的判断 —— 成员至少 2 个、一个 ref 只能进一个分组
 * 这类校验只有后端 lib/layout-groups.js 一处，界面把后端的原话照实显示（见 app/layout-panel.tsx）。
 */

/*
 * 清单里那一条控件（没有给 null）。「清单里有没有它 / 拿它的字段」都从这里走 ——
 * 同一条控件在界面几个地方（画布、层次图、面上清单）读出来的是同一份事实。
 */
export function controlOf(controls: LayoutControl[], ref: string): LayoutControl | null {
  return controls.find((item) => item.ref === ref) ?? null
}

/** 控件编号＝控件清单里的次序（1 起）；不在清单里的 ref 给 0（清单被换过时不硬编一个号）。 */
export function numberOf(controls: LayoutControl[], ref: string): number {
  const index = controls.findIndex((item) => item.ref === ref)
  return index < 0 ? 0 : index + 1
}

/* 一条控件的 value：它在 DSL 里那段文本（去掉两头空白）。「取 value」只有这一处。 */
export function valueOf(control: LayoutControl): string {
  return control.text.trim()
}

/* 按 ref 取 value：清单里没有这个 ref 就给空串。 */
export function textOf(controls: LayoutControl[], ref: string): string {
  const control = controlOf(controls, ref)
  return control ? valueOf(control) : ""
}

/** 一个控件的展示名：编号 + 类型 · value；清单里没有的 ref 照原样显示。 */
export function labelOf(controls: LayoutControl[], ref: string): string {
  const control = controlOf(controls, ref)
  if (!control) return ref
  const number = numberOf(controls, ref)
  const text = valueOf(control)
  return "#" + number + " " + (text ? control.controlType + " · " + text : control.controlType)
}

/** 还没进任何一组的控件（按清单次序）。 */
export function ungroupedControls(controls: LayoutControl[], groups: LayoutGroup[]): LayoutControl[] {
  const used = new Set<string>()
  for (const group of groups) for (const ref of group.members) used.add(ref)
  return controls.filter((control) => !used.has(control.ref))
}

/*
 * 把控件挪进某一组（组内成员与未分组控件都能拖）：这是一次「移动」（控件的归属只有一处），
 * 所以先从原组摘掉再放进目标组；已经在这一组里就不动。它不是校验 —— 表合不合法仍由后端判。
 */
export function moveMember(groups: LayoutGroup[], groupId: string, ref: string): LayoutGroup[] {
  const target = groups.find((group) => group.id === groupId)
  if (!target || target.members.includes(ref)) return groups
  const stripped = groups.map((group) => ({ ...group, members: group.members.filter((item) => item !== ref) }))
  return stripped.map((group) => (group.id === groupId ? { ...group, members: [...group.members, ref] } : group))
}

/** 从某一组里删掉一个控件。 */
export function removeMember(groups: LayoutGroup[], groupId: string, ref: string): LayoutGroup[] {
  return groups.map((group) => (group.id === groupId ? { ...group, members: group.members.filter((item) => item !== ref) } : group))
}

/*
 * 加一个新组（空组）：只挡住「名字是空的」这一次无意义点击 —— 组名唯一、成员够不够这类
 * 「表合不合法」往后端判（写回时会按原话拒收），这里不各判一遍。
 */
export function addGroup(groups: LayoutGroup[], id: string, kind: "column" | "row"): LayoutGroup[] {
  const name = id.trim()
  if (!name) return groups
  return [...groups, { id: name, kind: kind, members: [] }]
}

/** 删掉一个组（组里的控件回到未分组）。 */
export function removeGroup(groups: LayoutGroup[], id: string): LayoutGroup[] {
  return groups.filter((group) => group.id !== id)
}

/*
 * 布局树上那一行的 key（分区 / 分区里的某一行 / 某个控件 / 没归宿那一段）与「这一行盖住哪几个控件」。
 * 纯逻辑，与分组编辑同处：界面按 key 记住选了哪一行，要描的控件由 refsOfDerived 现算（不另存一份）。
 */
export const UNRESOLVED_KEY = "unresolved"

export function regionKey(id: string): string {
  return "region:" + id
}

export function rowKey(id: string, row: number): string {
  return regionKey(id) + "#row:" + row
}

export function controlKey(ref: string): string {
  return "ref:" + ref
}

export function refsOfDerived(derived: DerivedLayout, key: string): string[] {
  if (!key) return []
  if (key === UNRESOLVED_KEY) return derived.unresolved.map((item) => item.ref)
  if (key.startsWith("ref:")) return [key.slice("ref:".length)]
  const inRow = /^region:(.+)#row:(\d+)$/.exec(key)
  if (inRow) {
    const region = derived.regions.find((item) => item.id === inRow[1])
    return region ? cellsInRow(region, Number(inRow[2])).map((cell) => cell.ref) : []
  }
  const region = derived.regions.find((item) => regionKey(item.id) === key)
  return region ? region.cells.map((cell) => cell.ref) : []
}

/* 一个分区里落在第 k 行的格子：树按行摆、refsOfDerived 按行收，两处同一条判据。 */
export function cellsInRow(region: LayoutRegion, row: number): LayoutCell[] {
  return region.cells.filter((cell) => cell.row === row)
}

/* 一个分区里有哪些行（去重、从小到大）：树按它摆行。 */
export function rowsOfRegion(region: LayoutRegion): number[] {
  return [...new Set(region.cells.map((cell) => cell.row))].sort((left, right) => left - right)
}

