import type { LayoutBand, LayoutCell } from "@/lib/api"

/*
 * 用例里的格子夹具：读视图（lib/derived-layout.js）给的那个形状只在这里拼一次，几份用例共用它 ——
 * 形状再变（加字段、改归一口径）只改这一处，不会各文件各写一套。
 * 行列是「在这一层网格的第几行第几列」（产物给的非负整数都算数：那侧有从 0 起也有从 1 起的）；
 * 有 children 就是一个组，带的行列带就是那一层网格的。
 */

/** 一层网格的行列带：几条像素带 + 几条吃剩余（*）的带。 */
export function bands(rows: number, columns: number, starRows: number[] = [], starColumns: number[] = []) {
  const build = (count: number, stars: number[]): LayoutBand[] =>
    Array.from({ length: count }, (_item, index) => ({ star: stars.includes(index + 1), pixels: 0 }))
  return { rows: build(rows, starRows), columns: build(columns, starColumns) }
}

/** 一层网格里的一格：带行列、带方向；给了子网格就是一个组。 */
export function cell(
  ref: string,
  controlType: string,
  row: number,
  column: number,
  children: LayoutCell[] = [],
  axis: "" | "column" | "row" = "",
  childBands?: { rows: LayoutBand[]; columns: LayoutBand[] }
): LayoutCell {
  return {
    ref: ref,
    axis: axis,
    controlType: controlType,
    children: children,
    refs: [ref, ...children.flatMap((item) => item.refs)],
    row: row,
    column: column,
    ...(children.length > 0 ? { bands: childBands ?? bands(1, 1) } : {})
  }
}
