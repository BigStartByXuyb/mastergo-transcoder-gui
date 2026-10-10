import { describe, expect, it } from "vitest"

import {
  addGroup,
  labelOf,
  moveMember,
  numberOf,
  removeGroup,
  removeMember,
  ungroupedControls
} from "@/lib/layout-edit"
import type { LayoutControl, LayoutGroup } from "@/lib/api"

/*
 * 布局确认面板的纯逻辑：编号、未分组清单、分组的增删改。写回校验的判据在后端，这里不重复。
 */

function control(ref: string, controlType = "IconButton", text = ""): LayoutControl {
  return { ref: ref, controlType: controlType, text: text, absX: 0, absY: 0, w: 10, h: 10 }
}

const CONTROLS = [control("1:9", "IconButton", "确定"), control("1:10", "IconButton"), control("1:11", "TextBlock", "标题")]
const GROUPS: LayoutGroup[] = [{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }]

describe("layout-edit", () => {
  it("编号按清单次序，清单里没有的 ref 不编号、照原样显示", () => {
    expect(numberOf(CONTROLS, "1:9")).toBe(1)
    expect(numberOf(CONTROLS, "1:11")).toBe(3)
    expect(numberOf(CONTROLS, "9:9")).toBe(0)
    expect(labelOf(CONTROLS, "1:9")).toBe("#1 IconButton · 确定")
    expect(labelOf(CONTROLS, "1:10")).toBe("#2 IconButton")
    expect(labelOf(CONTROLS, "9:9")).toBe("9:9")
  })

  it("未分组清单＝没进任何组的控件", () => {
    expect(ungroupedControls(CONTROLS, GROUPS).map((item) => item.ref)).toEqual(["1:11"])
    expect(ungroupedControls(CONTROLS, []).length).toBe(3)
  })

  it("拖进另一组时先从原组删掉：一个 ref 只在最后一组里", () => {
    const moved = moveMember(GROUPS.concat([{ id: "Other", kind: "row", members: ["1:11"] }]), "Other", "1:9")
    expect(moved.find((group) => group.id === "RightTools")?.members).toEqual(["1:10"])
    expect(moved.find((group) => group.id === "Other")?.members).toEqual(["1:11", "1:9"])
  })

  it("拖进自己已在的那一组：不动（不重复登记）", () => {
    expect(moveMember(GROUPS, "RightTools", "1:9")).toEqual(GROUPS)
  })

  it("删成员、加组、删组各只动该动的地方", () => {
    expect(removeMember(GROUPS, "RightTools", "1:9")[0].members).toEqual(["1:10"])
    expect(addGroup(GROUPS, " TopBar ", "row").map((group) => group.id)).toEqual(["RightTools", "TopBar"])
    expect(addGroup(GROUPS, "   ", "row")).toEqual(GROUPS)
    expect(removeGroup(GROUPS, "RightTools")).toEqual([])
  })

})
