import type { LayoutBand, LayoutCell } from "@/lib/api"

/*
 * 用例里的格子夹具：读视图（lib/derived-layout.js）给的那个形状只在这里拼一次，几份用例共用它 ——
 * 形状再变（加字段、改归一口径）只改这一处，不会各文件各写一套。
 * 顺序就是摆的顺序（读视图按产物给的行列排好才出去）；有 children 就是一个组，
 * 带的行列带就是那一层网格的（哪一条吃剩余）。
 */

/** 一层网格的行列带：几条带里哪几条吃剩余（*）—— 「第几条」从 1 起。 */
export function bands(rows: number, columns: number, starRows: number[] = [], starColumns: number[] = []) {
  const build = (count: number, stars: number[]): LayoutBand[] =>
    Array.from({ length: count }, (_item, index) => ({ star: stars.includes(index + 1) }))
  return { rows: build(rows, starRows), columns: build(columns, starColumns) }
}

/** 一层网格里的一格：带方向；给了子网格就是一个组（没给带就是空表，照「产物没写带」算）。 */
export function cell(
  ref: string,
  controlType: string,
  children: LayoutCell[] = [],
  axis: "" | "column" | "row" = "",
  childBands?: { rows: LayoutBand[]; columns: LayoutBand[] }
): LayoutCell {
  return {
    ref: ref,
    group: children.length > 0,
    axis: axis,
    controlType: controlType,
    children: children,
    refs: [ref, ...children.flatMap((item) => item.refs)],
    ...(children.length > 0 ? { bands: childBands ?? bands(0, 0) } : {})
  }
}
