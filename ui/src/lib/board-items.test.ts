import { describe, expect, it } from "vitest"

import { fillTargets, keepPickedImages, parseBoardItems } from "@/lib/board-items"

const LINK = "https://mastergo.com/goto/x?file=1&layer_id=2:3"

describe("parseBoardItems", () => {
  it("一行一个链接，Target 省略时留空", () => {
    expect(parseBoardItems(LINK, "B")).toEqual([{ link: LINK, target: "", mode: "B" }])
  })

  it("支持 `链接 | Target`，两侧空白会被去掉", () => {
    expect(parseBoardItems(`  ${LINK}  |  F3Align `, "A")).toEqual([{ link: LINK, target: "F3Align", mode: "A" }])
  })

  it("跳过空行与没有链接的行", () => {
    expect(parseBoardItems(`\n\n| 只有 Target\n${LINK}\n`, "AB")).toEqual([{ link: LINK, target: "", mode: "AB" }])
  })

  it("Target 里再出现 | 时只取第一段之后的内容原样保留", () => {
    expect(parseBoardItems(`${LINK}|A|B`, "B")[0].target).toBe("A")
  })
})

describe("fillTargets", () => {
  const other = "https://mastergo.com/goto/y?file=1&layer_id=4:5"

  it("没写 Target 的行补上，写过的行不动", () => {
    const text = `${LINK}\n${other} | F2Given`
    const got = fillTargets(text, new Map([[LINK, "F1StopAdjust"], [other, "F2Other"]]))
    expect(got).toBe(`${LINK} | F1StopAdjust\n${other} | F2Given`)
  })

  it("没补到结果的行原样留着，空行也原样留着", () => {
    expect(fillTargets(`\n${LINK}\n`, new Map())).toBe(`\n${LINK}\n`)
  })

  it("补过之后再补不会写成两个 Target", () => {
    const once = fillTargets(LINK, new Map([[LINK, "F1StopAdjust"]]))
    expect(fillTargets(once, new Map([[LINK, "F1Other"]]))).toBe(once)
  })
})

describe("keepPickedImages", () => {
  const other = "https://mastergo.com/goto/y?file=1&layer_id=4:5"

  it("按链接记：行还在就留着，行没了就跟着走", () => {
    const picked = { [LINK]: "a.png", [other]: "b.png" }
    expect(keepPickedImages(picked, LINK, "A")).toEqual({ [LINK]: "a.png" })
  })
})
