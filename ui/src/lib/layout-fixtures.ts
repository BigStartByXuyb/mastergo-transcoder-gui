import type { LayoutCell, LayoutChild } from "@/lib/api"

/*
 * 用例里的格子夹具：读视图（lib/derived-layout.js）给的那个形状只在这里拼一次，几份用例共用它 ——
 * 形状再变（加字段、改跨度口径）只改这一处，不会各文件各写一套。
 * 顶层格子带行列（坐标从 1 起），子网格里的一格挂在父格子下、不带行列；两者的其余字段同形。
 */

/** 子网格里的一格。 */
export function child(ref: string, controlType = "", children: LayoutChild[] = [], container = false): LayoutChild {
  return {
    ref: ref,
    container: container,
    controlType: controlType,
    rowSpan: 1,
    columnSpan: 1,
    children: children,
    refs: [ref, ...children.flatMap((item) => item.refs)]
  }
}

/** 一个顶层格子（带行列）。 */
export function cell(
  ref: string,
  controlType: string,
  row: number,
  column: number,
  children: LayoutChild[] = [],
  container = false
): LayoutCell {
  return { ...child(ref, controlType, children, container), row: row, column: column }
}
