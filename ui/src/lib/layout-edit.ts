import type { DerivedLayout, LayoutCell, LayoutControl, LayoutGroup, LayoutRegion } from "@/lib/api"

/*
 * 布局确认面板的纯逻辑：控件怎么认（编号 / 展示名 / 未找到时按 ref）、分组的增删改，
 * 以及布局树那两个口径（行 key 的拼法与解析、一个分区有哪些行、哪些格子盖住某一行）。
 *
 * 这里只做「界面自己怎么算」这件事，不做「表合不合法」的判断 —— 成员至少 2 个、一个 ref 只能进一个分组
 * 这类校验只有后端 lib/layout-groups.js 一处，界面把后端的原话照实显示（见 app/layout-panel.tsx）。
 */

/* 产物把「这一格是个容器（里面还装着控件）」标成在 ref 前面加这个前缀：只认这一处。 */
const SYNTH_PREFIX = "synth:"

/* 查清单用的 ref：合成出来的容器要去掉那层前缀，剩下的才是它对应的那个节点。 */
function bareRef(ref: string): string {
  return ref.startsWith(SYNTH_PREFIX) ? ref.slice(SYNTH_PREFIX.length) : ref
}

/** 这一格是不是产物合成出来的容器（它里面还装着控件）。 */
export function isContainer(ref: string): boolean {
  return ref.startsWith(SYNTH_PREFIX)
}

/** 两条 ref 指不指向同一个节点（合成出来的容器剥掉那层前缀再比）。 */
export function sameNode(left: string, right: string): boolean {
  return bareRef(left) === bareRef(right)
}

/*
 * 清单里那一条控件（没有给 null）。「清单里有没有它 / 拿它的字段」都从这里走 ——
 * 同一条控件在界面几个地方（画布、布局树、面上清单）读出来的是同一份事实。
 */
function controlOf(controls: LayoutControl[], ref: string): LayoutControl | null {
  const bare = bareRef(ref)
  return controls.find((item) => item.ref === bare) ?? null
}

/** 控件编号＝控件清单里的次序（1 起）；不在清单里的 ref 给 0（清单被换过时不硬编一个号）。 */
export function numberOf(controls: LayoutControl[], ref: string): number {
  const bare = bareRef(ref)
  const index = controls.findIndex((item) => item.ref === bare)
  return index < 0 ? 0 : index + 1
}

/* 一条控件的 value：它在 DSL 里那段文本（去掉两头空白）。「取 value」只有这一处。 */
function valueOf(control: LayoutControl): string {
  return control.text.trim()
}

/* 一个控件拿什么当名字：value 优先，没有才退回控件类型（两个都没有就用 ref）。
 * 「按哪个字段认这个控件」只有这一处 —— 布局树那一行按它显示；面上那份清单摆的是「类型 · value」（见 labelOf）。 */
export function displayNameOf(controls: LayoutControl[], ref: string): string {
  const control = controlOf(controls, ref)
  if (!control) return bareRef(ref)
  return valueOf(control) || control.controlType || bareRef(ref)
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

/*
 * key 的拼法：分区 → 第几组（分区里的某一行）→ 格子路径（每段一个 ref，套几层就有几段），
 * 按下面三处接起来（拼装与解析都只认这三处）。
 * 前提：ref 与分区 id 里不含这些片段（产物的 ref 形如 `1872:59913`，分区 id 形如 `work-area`）。
 */
/* 「分区里的第几组」那段 key 的分隔：拼（groupKey）与解（refsOfDerived）只认这一处。 */
const GROUP_SEP = "#g"
/* 「某个控件」那段 key 的前缀：同样只认这一处。 */
const REF_PREFIX = "ref:"
/* key 里两段之间的分隔：同样只认这一处。 */
const CONTROL_SEP = "/"

export function regionKey(id: string): string {
  return "region:" + id
}

export function groupKey(id: string, group: number): string {
  return regionKey(id) + GROUP_SEP + group
}

function controlKey(ref: string): string {
  return REF_PREFIX + ref
}

/* 树上一条格子行的 key：分区 + 第几组 + 从这一组下去的路径（套着的几层各占一段）。 */
export function controlLineKey(regionId: string, group: number, path: string[]): string {
  return groupKey(regionId, group) + path.map((ref) => CONTROL_SEP + controlKey(ref)).join("")
}

/* 按路径找那一格：每段是那一层里的一个 ref。 */
function cellAt(cells: LayoutCell[], path: string[]): LayoutCell | null {
  const hit = cells.find((cell) => cell.ref === path[0])
  if (!hit) return null
  return path.length === 1 ? hit : cellAt(hit.children, path.slice(1))
}

/* 这一格在画布上盖住的 ref：它自己，加上它里面装着的那些（往下都算）。 */
function refsOfCell(cell: LayoutCell): string[] {
  return [cell.ref, ...refsOfCells(cell.children)]
}

function refsOfCells(cells: LayoutCell[]): string[] {
  return cells.flatMap(refsOfCell)
}

export function refsOfDerived(derived: DerivedLayout | null, key: string): string[] {
  if (!derived || !key) return []
  if (key === UNRESOLVED_KEY) return derived.unresolved.map((item) => item.ref)
  // 段一：[分区] 或 [分区 + 第几组]；后面的段都是「这一组的格子往下走的路径」。
  const [head, ...tail] = key.split(CONTROL_SEP)
  const [regionPart, groupPart] = head.split(GROUP_SEP)
  const region = derived.regions.find((item) => regionKey(item.id) === regionPart)
  if (!region) return []
  const path: string[] = []
  for (const part of tail) {
    if (!part.startsWith(REF_PREFIX)) return []
    path.push(part.slice(REF_PREFIX.length))
  }
  // 没有组号＝整个分区；有组号＝那一组（组号数的是「有格子的行」，与树上的编号同一处算）。
  const cells = groupPart === undefined ? region.cells : cellsInRow(region, rowsOfRegion(region)[Number(groupPart) - 1])
  if (path.length === 0) return refsOfCells(cells)
  const hit = cellAt(cells, path)
  return hit ? refsOfCell(hit) : []
}

/* 一个格子盖住哪几行（含跨行）：行区间只有这一处；跨度由后端归一成至少 1（lib/derived-layout.js），这里直接用。 */
function rowRangeOf(cell: LayoutCell): number[] {
  const rows: number[] = []
  for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) rows.push(row)
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

