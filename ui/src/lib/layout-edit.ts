import type { LayoutControl, LayoutGroup } from "@/lib/api"

/*
 * 布局确认面板的两件纯逻辑：控件编号（人对编号说话，分组表里存 ref）与分组的增删改。
 *
 * 这里只做「人怎么改」这件事，不做「表合不合法」的判断 —— 成员至少 2 个、一个 ref 只能进一个分组
 * 这类校验只有后端 lib/layout-groups.js 一处，界面把后端的原话照实显示（见 app/layout-panel.tsx）。
 */

/** 控件编号＝控件清单里的次序（1 起）；不在清单里的 ref 给 0（清单被换过时不硬编一个号）。 */
export function numberOf(controls: LayoutControl[], ref: string): number {
  const index = controls.findIndex((item) => item.ref === ref)
  return index < 0 ? 0 : index + 1
}

/** 一个控件的展示名：编号 + 类型 · 文本；清单里没有的 ref 照原样显示。 */
export function labelOf(controls: LayoutControl[], ref: string): string {
  const number = numberOf(controls, ref)
  const control = controls.find((item) => item.ref === ref)
  if (!control) return ref
  const text = control.text.trim()
  return "#" + number + " " + (text ? control.controlType + " · " + text : control.controlType)
}

/** 还没进任何一组的控件（按清单次序）。 */
export function ungroupedControls(controls: LayoutControl[], groups: LayoutGroup[]): LayoutControl[] {
  const used = new Set<string>()
  for (const group of groups) for (const ref of group.members) used.add(ref)
  return controls.filter((control) => !used.has(control.ref))
}

/*
 * 把控件挪进某一组：这是一次「移动」（控件的归属只有一处），所以先从原组摘掉再放进目标组；
 * 已经在这一组里就不动。它不是校验 —— 表合不合法仍由后端判。
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

/** 加一个新组（空组）；组名已在用则原样返回，调用方据此提示重名。 */
export function addGroup(groups: LayoutGroup[], id: string, kind: "column" | "row"): LayoutGroup[] {
  const name = id.trim()
  if (!name || groups.some((group) => group.id === name)) return groups
  return [...groups, { id: name, kind: kind, members: [] }]
}

/** 删掉一个组（组里的控件回到未分组）。 */
export function removeGroup(groups: LayoutGroup[], id: string): LayoutGroup[] {
  return groups.filter((group) => group.id !== id)
}
