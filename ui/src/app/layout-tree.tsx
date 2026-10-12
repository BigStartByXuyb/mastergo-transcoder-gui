import type { DerivedLayout, LayoutCell, LayoutControl } from "@/lib/api"
import {
  cellsInRow,
  controlLineKey,
  displayNameOf,
  groupKey,
  isContainer,
  numberOf,
  regionKey,
  rowsOfRegion,
  sameNode,
  UNRESOLVED_KEY
} from "@/lib/layout-edit"
import { cn } from "@/lib/utils"

/*
 * 布局树：作业A **第 8 步推出来的布局**，摆成正常的树 —— 分区 → 组（分区里的某一行）→ 格子 → 格子里的格子。
 *
 * 每一行都带得起「人怎么指它」的名字：控件行是它在清单里的号（#6），组行是它在这一页里的号（组 #2），
 * 所以人能直接说「把 #6 挪到组 #2」。
 * 点一行，把它盖住的控件在画布上描出来（key → refs 只有 refsOfDerived 一处）。
 */

/* 一个控件在树上的名字：清单里有它就用清单的（号 + value），没有就退回产物给的类型，再没有才是 ref。 */
function nameOf(controls: LayoutControl[], ref: string, controlType: string): string {
  const number = numberOf(controls, ref)
  if (number > 0) return "#" + number + " " + displayNameOf(controls, ref)
  return controlType || displayNameOf(controls, ref)
}

/* 一个格子在树上的文案：名字 + 它是容器 / 跨了几行几列（两样都是产物说的事实）。 */
function cellLabel(controls: LayoutControl[], cell: LayoutCell): string {
  const marks: string[] = []
  if (isContainer(cell.ref)) marks.push("容器")
  if (cell.rowSpan > 1 || cell.columnSpan > 1) marks.push("跨 " + cell.rowSpan + " 行 × " + cell.columnSpan + " 列")
  const name = nameOf(controls, cell.ref, cell.controlType)
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
  cell: LayoutCell,
  depth: number,
  controls: LayoutControl[]
) {
  const next = [...path, cell.ref]
  lines.push({ key: controlLineKey(regionId, group, next), depth: depth, strong: true, label: cellLabel(controls, cell) })
  for (const child of cell.children) {
    /* 产物会把容器自己又列在它的子网格里一次：跳过那一层（它的孩子并上来），同一个东西不在树上出现两遍。 */
    if (sameNode(child.ref, cell.ref)) {
      const through = [...next, child.ref]
      for (const grand of child.children) pushCell(lines, regionId, group, through, grand, depth + 1, controls)
      continue
    }
    pushCell(lines, regionId, group, next, child, depth + 1, controls)
  }
}

function linesOfDerived(derived: DerivedLayout, controls: LayoutControl[]): TreeLine[] {
  const lines: TreeLine[] = []
  for (const region of derived.regions) {
    lines.push({
      key: regionKey(region.id),
      depth: 0,
      strong: true,
      label: region.name + " · " + (region.emit ? "发射" : "只注册")
    })
    /*
     * 组号数的是「有格子的行」；跨行的格子只在它起始的那一组里展开一次（它盖住哪几行已经写在标签里），
     * 否则一个跨 6 行的容器会把整棵子树在 6 个组里各复制一遍。点某一组时画布上照旧会描出盖住它的控件。
     */
    rowsOfRegion(region).forEach((row, index) => {
      const group = index + 1
      lines.push({ key: groupKey(region.id, group), depth: 1, strong: false, label: "组 #" + group })
      for (const cell of cellsInRow(region, row)) {
        if (cell.row !== row) continue
        pushCell(lines, region.id, group, [], cell, 2, controls)
      }
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
          布局那一步推出来的分区 → 组 → 格子；点一行，它会盖住的控件在画布上描出来。
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
