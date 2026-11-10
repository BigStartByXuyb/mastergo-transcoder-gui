import { describe, expect, it } from "vitest"

import {
  fillTargets,
  keepPickedImages,
  parseBoardItems,
  parseBoardRows,
  pickedForLink,
  withPickedImage
} from "@/lib/board-items"

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
    expect(keepPickedImages(picked, LINK)).toEqual({ [LINK]: "a.png" })
  })

  it("填完整链接时把待认领那一份归到这一页", () => {
    expect(keepPickedImages({ "": "a.png" }, LINK)).toEqual({ [LINK]: "a.png" })
  })

  it("链接完整时认领待选图；换到另一页后不沿用", () => {
    const claimed = keepPickedImages({ "": "a.png" }, LINK)
    expect(claimed).toEqual({ [LINK]: "a.png" })
    expect(pickedForLink(claimed, LINK)).toBe("a.png")
    expect(keepPickedImages(claimed, other)).toEqual({})
    expect(pickedForLink(keepPickedImages(claimed, other), other)).toBeNull()
  })

  it("链接还没填完整时不提前认领，继续留在待认领那一格", () => {
    expect(keepPickedImages({ "": "a.png" }, "https://mastergo.com/goto/x?file=1")).toEqual({ "": "a.png" })
  })
})

describe("parseBoardRows", () => {
  const other = "https://mastergo.com/goto/y?file=1&layer_id=4:5"

  it("行号是文本框里那一行（空行也占一行）", () => {
    expect(parseBoardRows(`\n${LINK}\n\n${other} | F2`, "A").map((row) => row.line)).toEqual([2, 4])
  })
})

describe("withPickedImage", () => {
  const other = "https://mastergo.com/goto/y?file=1&layer_id=4:5"

  it("按链接置入一张", () => {
    expect(withPickedImage({}, LINK, "a.png")).toEqual({ [LINK]: "a.png" })
  })

  it("移除就把键也去掉，别的行不动", () => {
    expect(withPickedImage({ [LINK]: "a.png", [other]: "b.png" }, LINK, null)).toEqual({ [other]: "b.png" })
  })

  it("同一个链接再选一张就是换那一张", () => {
    expect(withPickedImage({ [LINK]: "a.png" }, LINK, "b.png")).toEqual({ [LINK]: "b.png" })
  })

  it("链接首尾空白不改变图片键：写入、读取、换链接保留三处都归一", () => {
    const picked = withPickedImage({}, `  ${LINK}  `, "a.png")
    expect(picked).toEqual({ [LINK]: "a.png" })
    expect(pickedForLink(picked, ` ${LINK} `)).toBe("a.png")
    expect(keepPickedImages(picked, `  ${LINK}  `)).toEqual({ [LINK]: "a.png" })
  })

  it("还没填链接时选的那一份记在待认领那一格，链接完整后由换链接动作认领", () => {
    const picked = withPickedImage({}, "", "a.png")
    expect(picked).toEqual({ "": "a.png" })
    expect(pickedForLink(picked, LINK)).toBeNull()
    expect(keepPickedImages(picked, LINK)).toEqual({ [LINK]: "a.png" })
  })

  it("再选一张或移除都把待认领那一格清掉（移除之后不会又从那儿冒出来）", () => {
    const unclaimed = withPickedImage({}, "", "a.png")
    expect(withPickedImage(unclaimed, LINK, "b.png")).toEqual({ [LINK]: "b.png" })
    expect(withPickedImage(unclaimed, LINK, null)).toEqual({})
  })

  it("换到另一页时旧的一页那一份不算数", () => {
    expect(keepPickedImages({ [LINK]: "a.png" }, other)).toEqual({})
  })
})

describe("pickedForLink", () => {
  const other = "https://mastergo.com/goto/y?file=1&layer_id=4:5"

  it("按链接取那一格；没有就空", () => {
    expect(pickedForLink({ [LINK]: "a.png" }, LINK)).toBe("a.png")
    expect(pickedForLink({ [LINK]: "a.png" }, other)).toBeNull()
  })

  it("非空但还没认领时不给空串那一格", () => {
    expect(pickedForLink({ "": "a.png" }, LINK)).toBeNull()
  })

  it("这一页自己那一格优先于待认领的那一份", () => {
    expect(pickedForLink({ "": "unclaimed.png", [LINK]: "mine.png" }, LINK)).toBe("mine.png")
  })
})
