import { describe, expect, it } from "vitest"

import { parseBoardItems } from "@/lib/board-items"

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
