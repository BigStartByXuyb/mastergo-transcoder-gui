import type { DerivedLayout, LayoutBand, LayoutChild, LayoutControl } from "@/lib/api"
import {
  controlLineKey,
  displayNameOf,
  groupsOf,
  groupKey,
  numberOf,
  regionKey,
  shapeOfRegion,
  UNRESOLVED_KEY
} from "@/lib/layout-edit"
import { cn } from "@/lib/utils"

/*
 * 布局树：作业A **第 8 步推出来的布局**，摆成正常的树 —— 分区 → 组（分区里的某一行）→ 格子 → 格子里的格子。
 *
 * 每一行都带得起「人怎么指它」的名字：控件行是它的号加名字（#6 Camera；清单里没有的按产物给的类型或 ref 显示），
 * 组行是它在这个分区里的号（组 #2）。
 * 点一行，把它盖住的控件在画布上描出来（key → refs 只有 refsOfDerived 一处）。
 */

/* 一个控件在树上的名字：清单里有它就用清单的（号 + value），没有就退回产物给的类型，再没有才是 ref。 */
function nameOf(controls: LayoutControl[], ref: string, controlType: string): string {
  const number = numberOf(controls, ref)
  if (number > 0) return "#" + number + " " + displayNameOf(controls, ref)
  return controlType || displayNameOf(controls, ref)
}

/* 吃剩余的那几条带（第几条，1 起）：行/列标题上要标 * 的号 —— 判据只有这一处。 */
function starBands(bands: LayoutBand[] | undefined): number[] {
  return (bands ?? []).map((band, index) => (band.star ? index + 1 : 0)).filter((index) => index > 0)
}

/* 一个格子在树上的文案：名字 + 它是不是容器（垂直/水平布局）/ 跨了几行几列（都是产物给的事实）。 */
function cellLabel(controls: LayoutControl[], cell: LayoutChild): string {
  const marks: string[] = []
  if (cell.container) {
    const axis = cell.axis === "column" ? "垂直布局" : cell.axis === "row" ? "水平布局" : "方向不明"
    marks.push("组：" + axis)
  }
  if (cell.rowSpan > 1 || cell.columnSpan > 1) marks.push("跨 " + cell.rowSpan + " 行 × " + cell.columnSpan + " 列")
  /* 容器的层名用 DSL 给的那个（产物不带名字）；取不到就退回清单里那条的名字。 */
  const name = cell.container && cell.name ? cell.name : nameOf(controls, cell.ref, cell.controlType)
  return marks.length > 0 ? name + "（" + marks.join("，") + "）" : name
}

/* 树上的每一行（纯数据）：key / 缩进 / 是否加粗 / 文案 —— 从哪里来（分区/组/格子/没归宿）只在这一处拼。 */
type TreeLine = { key: string; depth: number; strong: boolean; label: string }

/* 一格连同它里面装着的那几层：套几层就往下摆几层。 */
function pushCell(
  lines: TreeLine[],
  regionId: string,
  group: number,
  path: string[],
  cell: LayoutChild,
  depth: number,
  controls: LayoutControl[]
) {
  const next = [...path, cell.ref]
  lines.push({ key: controlLineKey(regionId, group, next), depth: depth, strong: true, label: cellLabel(controls, cell) })
  for (const child of cell.children) pushCell(lines, regionId, group, next, child, depth + 1, controls)
}

function linesOfDerived(derived: DerivedLayout, controls: LayoutControl[]): TreeLine[] {
  const lines: TreeLine[] = []
  for (const region of derived.regions) {
    const shape = shapeOfRegion(region)
    /* 行列都按格子算（与下面摆出来的组、格子同一处口径）；一个格子都没有的分区就不写这两数。 */
    const size = shape.rows > 0 ? " · " + shape.rows + " 行 × " + shape.columns + " 列" : ""
    /* 列带里吃剩余的那几条：窗口变大时变宽的就是它们（行带在下面每一行上标）。 */
    const starColumns = starBands(region.bands?.columns)
    const columnsNote = starColumns.length > 0 ? " · 第 " + starColumns.join("、") + " 列吃剩余（*）" : ""
    lines.push({
      key: regionKey(region.id),
      depth: 0,
      strong: true,
      label: region.name + " · " + (region.emit ? "发射" : "只注册") + size + columnsNote
    })
    const starRows = starBands(region.bands?.rows)
    /*
     * 每一组展开的是「从这一行起始的格子」—— 跨行的只在它起始的那一组里展开一次（跨了几行已经写在标签里），
     * 否则一个跨 6 行的容器会把整棵子树在 6 个组里各复制一遍。点某一组时画布上照旧会描出盖住它的控件。
     */
    groupsOf(region).forEach(({ group, covering, starting }) => {
      /*
       * 一「组」是分区里的一行：行号就是产物给的那条行带。这一行里不止一个格子时（含从上面跨下来的），
       * 它们在那一行里左右排；哪一条行带吃剩余也标在标题上。
       */
      const across = covering.length > 1 ? "（横排）" : ""
      const star = starRows.includes(group) ? "（* 吃剩余）" : ""
      lines.push({ key: groupKey(region.id, group), depth: 1, strong: false, label: "第 " + group + " 行" + star + across })
      for (const cell of starting) pushCell(lines, region.id, group, [], cell, 2, controls)
    })
  }
  if (derived.unresolved.length > 0) {
    lines.push({ key: UNRESOLVED_KEY, depth: 0, strong: true, label: "没归宿的 " + derived.unresolved.length + " 个" })
  }
  return lines
}

export function LayoutTree(props: {
  /** 推导结果；还没读到这一页时是 null（这块不摆）。 */
  derived: DerivedLayout | null
  controls: LayoutControl[]
  /** 现在选中的是哪一行（调用方持有；空串＝没选）。 */
  selected: string
  /** 点了一行：把它的 key 回给调用方（选中态与要描的控件都由调用方一处管）。 */
  onPick: (key: string) => void
}) {
  if (!props.derived) return null

  /*
   * 不可用时只说后端给的那句（措辞只有 lib/derived-layout.js 一处，界面不另拟一份）；
   * 到这一支就是后端说的「还没有产物」，reason 一定在。
   */
  if (!props.derived.available) {
    return <p className="text-muted-foreground text-xs">{props.derived.reason}</p>
  }

  const lines = linesOfDerived(props.derived, props.controls)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">布局树</span>
        <span className="text-muted-foreground text-xs">
          布局那一步推出来的分区 → 组（它推出来的某一行）→ 格子；点一行，它会盖住的控件在画布上描出来。
        </span>
      </div>
      <div className="max-h-80 overflow-auto rounded-md border p-2">
        <div className="flex flex-col gap-1">
          {lines.map((line) => (
            <button
              key={line.key}
              type="button"
              data-selected={props.selected === line.key}
              onClick={() => props.onPick(line.key)}
              className={cn(
                "rounded px-1 py-0.5 text-left text-xs hover:bg-accent",
                props.selected === line.key && "bg-accent text-accent-foreground",
                line.strong ? "text-foreground" : "text-muted-foreground"
              )}
              style={{ paddingLeft: 4 + line.depth * 12 }}
            >
              {line.label}
            </button>
          ))}
          {/* 没归宿那几条的下面是插件给的原因（鼠标停上去看），不进树的行里。 */}
          {props.derived.unresolved.map((item, index) => (
            <span
              key={index + ":" + item.ref}
              className="text-muted-foreground text-xs"
              style={{ paddingLeft: 16 }}
              title={item.reason}
            >
              {nameOf(props.controls, item.ref, "")}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
