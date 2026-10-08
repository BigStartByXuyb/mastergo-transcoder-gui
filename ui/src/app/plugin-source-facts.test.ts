import { describe, expect, it } from "vitest"

import { sourceStatusText, sourceTone } from "@/app/plugin-source-facts"

/*
 * 「一处来源此刻是什么处境」与「查找顺序条上怎么画」是同一对输入（active / exists）的两个出口：
 * 文字与亮/灰得成对 —— 不能一处说「正在用」、另一处画成灰的。
 */
describe("一处来源的说法与画法", () => {
  it("正在用：文字是「正在用」，画成亮的", () => {
    expect(sourceStatusText(true, true)).toBe("正在用")
    expect(sourceTone(true, true)).toContain("font-medium")
  })

  it("有但没用＝「可用」＋中灰", () => {
    expect(sourceStatusText(false, true)).toBe("可用")
    expect(sourceTone(false, true)).toBe("text-muted-foreground")
  })

  it("没有＝「没有」＋更淡的灰", () => {
    expect(sourceStatusText(false, false)).toBe("没有")
    expect(sourceTone(false, false)).toBe("text-muted-foreground/60")
  })
})
