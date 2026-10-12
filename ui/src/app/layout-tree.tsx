import type { DerivedLayout, LayoutControl } from "@/lib/api"
import {
  cellsInRow,
  controlKey,
  controlOf,
  numberOf,
  regionKey,
  rowKey,
  rowsOfRegion,
  textOf,
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

/* 一个控件在树上的名字：value 优先，没有就退回控件类型；末尾带它在清单里的号。 */
function controlLabel(controls: LayoutControl[], ref: string): string {
  const control = controlOf(controls, ref)
  const head = textOf(controls, ref) || (control ? control.controlType : ref)
  const number = numberOf(controls, ref)
  return number > 0 ? head + " · #" + number : head
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

  const line = (lineProps: { label: string; lineKey: string; depth: number; strong?: boolean }) => (
    <button
      key={lineProps.lineKey}
      type="button"
      data-selected={props.selected === lineProps.lineKey}
      onClick={() => props.onPick(lineProps.lineKey)}
      className={cn(
        "rounded px-1 py-0.5 text-left text-xs hover:bg-accent",
        props.selected === lineProps.lineKey && "bg-accent text-accent-foreground",
        lineProps.strong ? "text-foreground" : "text-muted-foreground"
      )}
      style={{ paddingLeft: 4 + lineProps.depth * 12 }}
    >
      {lineProps.label}
    </button>
  )

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
          {props.derived.regions.map((region) => (
            <div key={region.id} className="flex flex-col gap-0.5">
              {line({
                lineKey: regionKey(region.id),
                depth: 0,
                strong: true,
                label:
                  region.name +
                  " · " +
                  (region.emit ? "发射" : "只注册") +
                  " · " +
                  region.rows +
                  " 行 × " +
                  region.columns +
                  " 列"
              })}
              {rowsOfRegion(region).map((row) => (
                <div key={row} className="flex flex-col gap-0.5">
                  {line({ lineKey: rowKey(region.id, row), depth: 1, label: "第 " + row + " 行" })}
                  {cellsInRow(region, row).map((cell) =>
                    line({
                      lineKey: controlKey(cell.ref),
                      depth: 2,
                      strong: true,
                      label:
                        controlLabel(props.controls, cell.ref) +
                        "（第 " +
                        cell.column +
                        " 列" +
                        (cell.rowSpan > 1 || cell.columnSpan > 1
                          ? "，跨 " + cell.rowSpan + " 行 × " + cell.columnSpan + " 列"
                          : "") +
                        "）"
                    })
                  )}
                </div>
              ))}
            </div>
          ))}
          {props.derived.unresolved.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {line({
                lineKey: UNRESOLVED_KEY,
                depth: 0,
                strong: true,
                label: "没归宿的 " + props.derived.unresolved.length + " 个"
              })}
              {props.derived.unresolved.map((item) => (
                <span
                  key={item.ref}
                  className="text-muted-foreground text-xs"
                  style={{ paddingLeft: 16 }}
                  title={item.reason}
                >
                  {controlLabel(props.controls, item.ref)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
