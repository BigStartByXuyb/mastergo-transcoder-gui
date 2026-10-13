import type { DerivedLayout, LayoutBand, LayoutCell, LayoutControl, LayoutGroup } from "@/lib/api"

/*
 * 布局确认面板的纯逻辑：控件怎么认（编号 / 展示名 / 未找到时按 ref）、分组的增删改，
 * 以及布局树上那几行怎么算（分区 → 组 → 控件，加上树下面那两块读数）。
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

/*
 * 布局树上那几行：key 是这一行的身份（React key 与选中态都用它），hit 是这一行盖住的控件。
 * extra 那两行（摆不进树的 / 插件报的单条目栏）另带 items：每条的 ref、它在清单里的名字、原因。
 */
export type TreeLine =
  | { key: string; depth: number; kind: "region" | "group" | "control"; label: string; hit: string[] }
  | {
      key: string
      depth: number
      kind: "extra"
      label: string
      hit: string[]
      items: { ref: string; label: string; reason: string }[]
    }

/* 树下面那两块读数各占一行（不属于任何分区，就各自一句）。 */
const UNPLACED_KEY = "unplaced"
const SINGLES_KEY = "singles"

/* 一个控件在树上的名字：清单里有它就用清单的（号 + value），没有就退回产物给的类型，再没有才是 ref。 */
function nameOf(controls: LayoutControl[], ref: string, controlType: string): string {
  const number = numberOf(controls, ref)
  if (number > 0) return "#" + number + " " + displayNameOf(controls, ref)
  return controlType || displayNameOf(controls, ref)
}

/* 一条带是不是吃剩余（*）：第几条（1 起）—— 行带列带共用这一处。 */
function starBands(bands: LayoutBand[] | undefined): number[] {
  return (bands ?? []).map((band, index) => (band.star ? index + 1 : 0)).filter((index) => index > 0)
}

/*
 * 一层网格里谁吃剩余怎么写：行、列各一段，都没有就是空串 —— 分区行与组行共用这一处。
 * 只有一条带的那种方向不写：那一条必然占满整层，说「它吃剩余」等于没说什么。
 */
function starNote(bands: { rows: LayoutBand[]; columns: LayoutBand[] } | undefined): string {
  const rows = starBands(bands?.rows)
  const columns = starBands(bands?.columns)
  const parts: string[] = []
  if (rows.length > 0 && (bands?.rows.length ?? 0) > 1) parts.push("第 " + rows.join("、") + " 行")
  if (columns.length > 0 && (bands?.columns.length ?? 0) > 1) parts.push("第 " + columns.join("、") + " 列")
  return parts.length > 0 ? " · " + parts.join("、") + "吃剩余（*）" : ""
}

/* 这一层网格几行几列（按产物给的带数）；两样都有才写，缺一样就不拿 0 顶上。 */
function shapeNote(bands: { rows: LayoutBand[]; columns: LayoutBand[] } | undefined): string {
  if (!bands || bands.rows.length === 0 || bands.columns.length === 0) return ""
  return " · " + bands.rows.length + " 行 × " + bands.columns.length + " 列"
}

/* 组往哪个方向排：照产物给的方向念，产物没给就说方向不明。 */
function axisLabel(axis: LayoutCell["axis"]): string {
  return axis === "column" ? "垂直布局" : axis === "row" ? "水平布局" : "方向不明"
}

/*
 * 分区那一行的 key；往下每套一层接一段 ref（只用来认这一行 —— React key 与选中态比较，不从 key 反解控件）。
 * 拼法的前提：ref 与分区 id 里不含 `region:`、`/ref:` 这两段（产物的 ref 形如 `1872:59913`，
 * 分区 id 形如 `work-area`）。
 */
function lineKey(regionId: string, path: string[]): string {
  return "region:" + regionId + path.map((ref) => "/ref:" + ref).join("")
}

/* 树下面那两块读数各占一行：标题 + 每条的 ref、名字与原因（原因在悬停提示里）。 */
function extraLine(key: string, label: string, items: { ref: string; reason: string }[], controls: LayoutControl[]): TreeLine {
  return {
    key: key,
    depth: 1,
    kind: "extra",
    label: label,
    hit: items.map((item) => item.ref),
    items: items.map((item) => ({ ref: item.ref, label: nameOf(controls, item.ref, ""), reason: item.reason }))
  }
}

/*
 * 一层格子摆成一组行：是组的先摆一行、再往里摆一层，是控件的直接摆一行。
 * 组的序号是「这一层里的第几个组」；这一格的 ref 在清单里（例如 GroupBox 这类自己也带子网格的控件）时，
 * 连它的号与名字一起写出来 —— 与画布上的号对得上。
 */
function pushCells(
  lines: TreeLine[],
  regionId: string,
  cells: LayoutCell[],
  path: string[],
  depth: number,
  controls: LayoutControl[]
) {
  let group = 0
  for (const cell of cells) {
    const next = [...path, cell.ref]
    const line = { key: lineKey(regionId, next), depth: depth, hit: cell.refs }
    if (cell.group) {
      group += 1
      const own = numberOf(controls, cell.ref)
      lines.push({
        ...line,
        kind: "group",
        label:
          "组 " + group + "（" + axisLabel(cell.axis) + "）" +
          (own > 0 ? " · " + nameOf(controls, cell.ref, cell.controlType) : "") +
          starNote(cell.bands)
      })
      pushCells(lines, regionId, cell.children, next, depth + 1, controls)
      continue
    }
    lines.push({ ...line, kind: "control", label: nameOf(controls, cell.ref, cell.controlType) })
  }
}

/*
 * 树上每一行的数据（纯函数）：树自己渲染用它，面板据它把「选中的那个 key」翻成要描的控件 ——
 * 一处算，两处读；读数刷新后翻出来的就是当前这一行的控件，不会留着上一份。
 * 这一步没跑过（或还没读到）时一行都不给。
 */
export function treeLinesOf(derived: DerivedLayout | null, controls: LayoutControl[]): TreeLine[] {
  if (!derived || !derived.available) return []
  const lines: TreeLine[] = []
  for (const region of derived.regions) {
    lines.push({
      key: lineKey(region.id, []),
      depth: 0,
      kind: "region",
      hit: region.cells.flatMap((cell) => cell.refs),
      label:
        region.name + " · " + (region.emit ? "发射" : "只注册") +
        shapeNote(region.bands) + starNote(region.bands)
    })
    pushCells(lines, region.id, region.cells, [], 1, controls)
  }
  if (derived.unplaced.length > 0) {
    lines.push(extraLine(UNPLACED_KEY, "摆不进树的 " + derived.unplaced.length + " 个", derived.unplaced, controls))
  }
  if (derived.singles.length > 0) {
    lines.push(extraLine(SINGLES_KEY, "插件报的单条目栏 · " + derived.singles.length + " 个", derived.singles, controls))
  }
  return lines
}
