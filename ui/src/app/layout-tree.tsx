import type { DerivedLayout, LayoutControl } from "@/lib/api"
import {
  cellsInRow,
  controlLineKey,
  displayNameOf,
  numberOf,
  regionKey,
  rowKey,
  rowsOfRegion,
  UNRESOLVED_KEY
} from "@/lib/layout-edit"
import { cn } from "@/lib/utils"

/*
 * 布局树：作业A **第 8 步推出来的布局**（分区 → 行/列 → 格子），不是设计稿原始层级 ——
 * 这一栏要回答的是「它把这一页分成了什么」；设计稿原本长什么样，画布那侧看得出来。
 *
 * 点一行，把这一行盖住的控件在画布上描出来（key → refs 只有 refsOfDerived 一处）。
 * 控件那一行显示它的 value（没有 value 就退回控件类型）+ 它在清单里的号；号由 numberOf 现算。
 */

/* 一个控件在树上的名字：名字取自 displayNameOf（value 优先），末尾带它在清单里的号。 */
function controlLabel(controls: LayoutControl[], ref: string): string {
  const head = displayNameOf(controls, ref)
  const number = numberOf(controls, ref)
  return number > 0 ? head + " · #" + number : head
}

/* 树上的每一行（纯数据）：key / 缩进 / 是否加粗 / 文案 —— 从哪里来（分区/行/控件/没归宿）只在这一处拼。 */
type TreeLine = { key: string; depth: number; strong: boolean; label: string }

function linesOfDerived(derived: DerivedLayout, controls: LayoutControl[]): TreeLine[] {
  const lines: TreeLine[] = []
  for (const region of derived.regions) {
    lines.push({
      key: regionKey(region.id),
      depth: 0,
      strong: true,
      label: region.name + " · " + (region.emit ? "发射" : "只注册")
    })
    for (const row of rowsOfRegion(region)) {
      lines.push({ key: rowKey(region.id, row), depth: 1, strong: false, label: "第 " + row + " 行" })
      for (const cell of cellsInRow(region, row)) {
        lines.push({
          key: controlLineKey(region.id, row, cell.ref),
          depth: 2,
          strong: true,
          label:
            controlLabel(controls, cell.ref) +
            "（第 " +
            cell.column +
            " 列" +
            (cell.rowSpan > 1 || cell.columnSpan > 1 ? "，跨 " + cell.rowSpan + " 行 × " + cell.columnSpan + " 列" : "") +
            "）"
        })
      }
    }
  }
  if (derived.unresolved.length > 0) {
    lines.push({ key: UNRESOLVED_KEY, depth: 0, strong: true, label: "没归宿的 " + derived.unresolved.length + " 个" })
  }
  return lines
}

export function LayoutTree(props: {
  derived: DerivedLayout
  controls: LayoutControl[]
  /** 现在选中的是哪一行（调用方持有；空串＝没选）。 */
  selected: string
  /** 点了一行：把它的 key 回给调用方（选中态与要描的控件都由调用方一处管）。 */
  onPick: (key: string) => void
}) {
  if (!props.derived.available) {
    return <p className="text-muted-foreground text-xs">{props.derived.reason || "还没有推导产物。"}</p>
  }

  const lines = linesOfDerived(props.derived, props.controls)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">布局树</span>
        <span className="text-muted-foreground text-xs">
          布局那一步推出来的分区 → 行/列 → 格子；点一行，它会盖住的控件在画布上描出来。
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
              {controlLabel(props.controls, item.ref)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
