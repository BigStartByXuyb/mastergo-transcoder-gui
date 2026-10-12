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
function controlOf(controls: LayoutControl[], ref: string): LayoutControl | null {
  return controls.find((item) => item.ref === ref) ?? null
}

/** 控件编号＝控件清单里的次序（1 起）；不在清单里的 ref 给 0（清单被换过时不硬编一个号）。 */
export function numberOf(controls: LayoutControl[], ref: string): number {
  const index = controls.findIndex((item) => item.ref === ref)
  return index < 0 ? 0 : index + 1
}

/* 一条控件的 value：它在 DSL 里那段文本（去掉两头空白）。「取 value」只有这一处。 */
function valueOf(control: LayoutControl): string {
  return control.text.trim()
}

/* 一个控件拿什么当名字：value 优先，没有才退回控件类型（两个都没有就用 ref）。
 * 「按哪个字段认这个控件」只有这一处 —— 清单那条展示名与布局树那一行都从它取。 */
export function displayNameOf(controls: LayoutControl[], ref: string): string {
  const control = controlOf(controls, ref)
  if (!control) return ref
  return valueOf(control) || control.controlType || ref
}

/*
 * 一个控件的展示名（面上那份清单用）：编号 + 类型 · value —— 面上看得出控件类型；
 * 布局树那行用 displayNameOf（value 领头，方便按 value 找）。
 * 两处取的是同两个原语（controlOf / valueOf），只有摆法不同。
 */
export function labelOf(controls: LayoutControl[], ref: string): string {
  const control = controlOf(controls, ref)
  if (!control) return ref
  const value = valueOf(control)
  return "#" + numberOf(controls, ref) + " " + (value ? control.controlType + " · " + value : control.controlType)
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

/* 「分区里的某一行」那段 key 的分隔：生产（rowKey）与解析（refsOfDerived）只认这一处。 */
const ROW_SEP = "#row:"
/* 「某个控件」那段 key 的前缀：同样只认这一处。 */
const REF_PREFIX = "ref:"
/* 控件行 key 里「分区 + 行」与「控件」两段的分隔：同样只认这一处。 */
const CONTROL_SEP = "/"

export function regionKey(id: string): string {
  return "region:" + id
}

export function rowKey(id: string, row: number): string {
  return regionKey(id) + ROW_SEP + row
}

function controlKey(ref: string): string {
  return REF_PREFIX + ref
}

/* 树上一条控件行的 key：带上「分区 + 行」，因为跨行的格子会在多行里各出现一次（同一条 ref 会有多条行）。 */
export function controlLineKey(regionId: string, row: number, ref: string): string {
  return rowKey(regionId, row) + CONTROL_SEP + controlKey(ref)
}

export function refsOfDerived(derived: DerivedLayout, key: string): string[] {
  if (!key) return []
  if (key === UNRESOLVED_KEY) return derived.unresolved.map((item) => item.ref)
  // 控件行可能带「分区 + 行」前缀（跨行的格子每行一条）：只看最后那一段。
  const tail = key.slice(key.lastIndexOf(CONTROL_SEP) + 1)
  if (tail.startsWith(REF_PREFIX)) return [tail.slice(REF_PREFIX.length)]
  if (key.includes(ROW_SEP)) {
    const [regionPart, rowPart] = key.split(ROW_SEP)
    const region = derived.regions.find((item) => regionKey(item.id) === regionPart)
    return region ? cellsInRow(region, Number(rowPart)).map((cell) => cell.ref) : []
  }
  const region = derived.regions.find((item) => regionKey(item.id) === key)
  return region ? region.cells.map((cell) => cell.ref) : []
}

/* 一个格子盖住哪几行（含跨行）：行区间只有这一处。 */
function rowRangeOf(cell: LayoutCell): number[] {
  const rows: number[] = []
  for (let row = cell.row; row < cell.row + Math.max(1, cell.rowSpan); row += 1) rows.push(row)
  return rows
}

/* 一个分区里盖住第 k 行的格子（跨行的格子每一行都算盖住）：树按行摆、refsOfDerived 按行收，都读 rowRangeOf。 */
export function cellsInRow(region: LayoutRegion, row: number): LayoutCell[] {
  return region.cells.filter((cell) => rowRangeOf(cell).includes(row))
}

/* 一个分区里有哪些行（把跨行的格子铺开、去重、从小到大）：树按它摆行。 */
export function rowsOfRegion(region: LayoutRegion): number[] {
  const rows = new Set<number>()
  for (const cell of region.cells) for (const row of rowRangeOf(cell)) rows.add(row)
  return [...rows].sort((left, right) => left - right)
}

