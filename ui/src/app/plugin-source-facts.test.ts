import { describe, expect, it } from "vitest"

import { sourceStatusText, sourceTone } from "@/app/plugin-source-facts"

/*
 * 「一处来源此刻是什么处境」与「查找顺序条上怎么画」是同一对输入（active / exists）的两个出口：
 * 文字与亮/灰得成对 —— 不能一处说「正在用」、另一处画成灰的。
 *
 * 这里只锁语义（三种处境的文字互不相同；三种处境的色调互不相同），不钉具体的类名 ——
 * 配色调整理时用例不该跟着改，行为变了才该红。
 */
describe("一处来源的说法与画法", () => {
  const states: [boolean, boolean][] = [[true, true], [false, true], [false, false]]

  it("三种处境的文字互不相同，且与处境对得上", () => {
    const texts = states.map(([active, exists]) => sourceStatusText(active, exists))
    expect(texts).toEqual(["正在用", "可用", "没有"])
    expect(new Set(texts).size).toBe(3)
  })

  it("三种处境的色调互不相同（亮/中灰/更淡成对，不塌成一档）", () => {
    const tones = states.map(([active, exists]) => sourceTone(active, exists))
    expect(new Set(tones).size).toBe(3)
    // 正在用那一档是「亮」：它必须带上加粗，另外两档不带。
    expect(tones[0]).toContain("font-medium")
    expect(tones[1]).not.toContain("font-medium")
    expect(tones[2]).not.toContain("font-medium")
  })
})
