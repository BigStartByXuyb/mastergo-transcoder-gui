import type { DerivedLayout, LayoutBand, LayoutCell, LayoutControl } from "@/lib/api"
import { displayNameOf, numberOf } from "@/lib/layout-edit"
import { cn } from "@/lib/utils"

/*
 * 布局树：作业A **第 8 步推出来的布局**，摆成正常的树 —— 分区 → 组（装着子网格的格子，可以再套）→ 控件。
 *
 * 组行说两件事：它是这一层里的第几个组、往哪个方向排（方向是产物给的，没给就说方向不明）；
 * 控件行说它在清单里的号加名字（#6 Camera；清单里没有的按产物给的类型或 ref 显示）。
 * 点一行，把它盖住的控件在画布上描出来 —— 那一行的 refs 由读视图一处摊平，界面不自己再算一遍。
 *
 * 树下面另摆两份读数（说的不是同一件事，所以分开摆）：
 *   摆不进树的 —— 产物里读不出行列坐标的格子，树里没有它们；
 *   插件报的单条目栏 —— 没进任何组的散条目，它们在树里照旧有自己的位置。
 */

/* 树上的每一行：key 是这一行的身份（React key 与选中态都用它），hit 是点它要描的控件。 */
type TreeLine = { key: string; depth: number; kind: "region" | "group" | "control"; label: string; hit: string[] }

/* 树下面那两行的 key：它们不属于任何分区，就各自一句。 */
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
    if (cell.children.length > 0) {
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

/* 分区那一行的 key；往下每套一层接一段 ref（只用来认这一行，不再从 key 反解控件）。 */
function lineKey(regionId: string, path: string[]): string {
  return "region:" + regionId + path.map((ref) => "/ref:" + ref).join("")
}

function linesOfDerived(derived: DerivedLayout, controls: LayoutControl[]): TreeLine[] {
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
  return lines
}

/* 行的轻重：分区与组是结构（加深），控件按普通字重。 */
const KIND_CLASS: Record<TreeLine["kind"], string> = {
  region: "text-foreground font-semibold",
  group: "text-foreground font-medium",
  control: "text-foreground"
}

/*
 * 树下面那两份读数各自一块：一行标题（可点，点了在画布上描出这几条）+ 每条的 ref 与原因。
 * 两块的摆法一样，只有 key、标题与条目从调用处给。
 */
function ExtraRows(props: {
  lineKey: string
  title: string
  items: { ref: string; reason: string }[]
  controls: LayoutControl[]
  selected: string
  onPick: (key: string, refs: string[]) => void
}) {
  if (props.items.length === 0) return null
  const on = props.selected === props.lineKey
  return (
    <div className="mt-2 flex flex-col gap-1">
      <button
        type="button"
        data-selected={on}
        onClick={() => props.onPick(props.lineKey, props.items.map((item) => item.ref))}
        className={cn(
          "rounded px-1 py-0.5 text-left text-xs hover:bg-accent text-foreground font-semibold",
          on && "bg-accent text-accent-foreground"
        )}
      >
        {props.title}
      </button>
      {props.items.map((item, index) => (
        /* 原因照产物 / 插件的原话说（鼠标停上去看），不在条目上另写一句。 */
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
  )
}

export function LayoutTree(props: {
  /** 推导结果；还没读到这一页时是 null（这块不摆）。 */
  derived: DerivedLayout | null
  controls: LayoutControl[]
  /** 现在选中的是哪一行（调用方持有；空串＝没选）。 */
  selected: string
  /** 点了一行：把它的 key 与它盖住的控件回给调用方（选中态与高亮都由调用方一处管）。 */
  onPick: (key: string, refs: string[]) => void
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
          布局那一步推出来的分区 → 组（装着东西的格子，可以再套）→ 控件；点一行，它盖住的控件在画布上描出来。
        </span>
      </div>
      <div className="max-h-80 overflow-auto rounded-md border p-2">
        <div className="flex flex-col gap-1">
          {lines.map((line) => (
            <button
              key={line.key}
              type="button"
              data-selected={props.selected === line.key}
              onClick={() => props.onPick(line.key, line.hit)}
              className={cn(
                "rounded px-1 py-0.5 text-left text-xs hover:bg-accent",
                props.selected === line.key && "bg-accent text-accent-foreground",
                KIND_CLASS[line.kind]
              )}
              style={{ paddingLeft: 4 + line.depth * 12 }}
            >
              {line.label}
            </button>
          ))}
        </div>
        <ExtraRows
          lineKey={UNPLACED_KEY}
          title={"摆不进树的 " + props.derived.unplaced.length + " 个"}
          items={props.derived.unplaced}
          controls={props.controls}
          selected={props.selected}
          onPick={props.onPick}
        />
        <ExtraRows
          lineKey={SINGLES_KEY}
          title={"插件报的单条目栏 · " + props.derived.singles.length + " 个"}
          items={props.derived.singles}
          controls={props.controls}
          selected={props.selected}
          onPick={props.onPick}
        />
      </div>
    </div>
  )
}
