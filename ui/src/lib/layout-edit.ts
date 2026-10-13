import type { LayoutControl, LayoutGroup } from "@/lib/api"

/*
 * 布局确认面板的纯逻辑：控件怎么认（编号 / 展示名 / 未找到时按 ref），以及分组的增删改。
 *
 * 这里只做「界面自己怎么算」这件事，不做「表合不合法」的判断 —— 成员至少 2 个、一个 ref 只能进一个分组
 * 这类校验只有后端 lib/layout-groups.js 一处，界面把后端的原话照实显示（见 app/layout-panel.tsx）。
 */

/*
 * 清单里那一条控件（没有给 null）。「清单里有没有它 / 拿它的字段」都从这里走 ——
 * 同一条控件在界面几个地方（画布、布局树、面上清单）读出来的是同一份事实。
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
 * 「按哪个字段认这个控件」只有这一处 —— 布局树那一行按它显示；面上那份清单摆的是「类型 · value」（见 labelOf）。 */
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
