import { describe, expect, it } from "vitest"

import { mappedAncestorOf, type ControlNode } from "@/lib/control-ancestry"

const ROOT = "357:208031"
const BOX = ROOT + "/1066:434323"
const ROW = BOX + "/1066:429780"
const CELL = ROW + "/1066:429762"

function byRef(entries: ControlNode[]): Map<string, ControlNode> {
  return new Map(entries.map((node) => [node.ref, node]))
}

describe("mappedAncestorOf", () => {
  it("直接父节点命中时返回它", () => {
    const map = byRef([
      { ref: ROOT },
      { ref: BOX, controlType: "ComboBox" },
      { ref: ROW }
    ])
    expect(mappedAncestorOf(ROW, map)).toEqual({ ref: BOX, controlType: "ComboBox" })
  })

  it("隔着两层才命中时返回上面那个已登记祖先", () => {
    const map = byRef([
      { ref: ROOT, controlType: "Panel" },
      { ref: BOX },
      { ref: ROW },
      { ref: CELL }
    ])
    expect(mappedAncestorOf(CELL, map)).toEqual({ ref: ROOT, controlType: "Panel" })
  })

  it("自己命中映射也不算自己的祖先", () => {
    const map = byRef([
      { ref: ROOT },
      { ref: BOX, controlType: "ComboBox" }
    ])
    expect(mappedAncestorOf(BOX, map)).toBeNull()
  })

  it("从近到远取第一个已登记祖先，远的那个不再覆盖", () => {
    const map = byRef([
      { ref: ROOT, controlType: "Panel" },
      { ref: BOX, controlType: "ComboBox" },
      { ref: ROW }
    ])
    expect(mappedAncestorOf(ROW, map)).toEqual({ ref: BOX, controlType: "ComboBox" })
  })

  it("谁都没登记时返回 null", () => {
    const map = byRef([{ ref: ROOT }, { ref: BOX }, { ref: ROW }])
    expect(mappedAncestorOf(ROW, map)).toBeNull()
  })

  it("ref 里没有 `/` 时返回 null", () => {
    const map = byRef([{ ref: ROOT, controlType: "Panel" }])
    expect(mappedAncestorOf(ROOT, map)).toBeNull()
    expect(mappedAncestorOf("", map)).toBeNull()
  })
})
