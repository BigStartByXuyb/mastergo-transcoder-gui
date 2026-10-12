import { describe, expect, it } from "vitest"

import {
  addGroup,
  displayNameOf,
  labelOf,
  moveMember,
  numberOf,
  refsOfDerived,
  removeGroup,
  removeMember,
  ungroupedControls
} from "@/lib/layout-edit"
import type { DerivedLayout, LayoutControl, LayoutGroup } from "@/lib/api"

/*
 * 布局确认面板的纯逻辑：编号、未分组清单、分组的增删改。写回校验的判据在后端，这里不重复。
 */

function control(ref: string, controlType = "IconButton", text = ""): LayoutControl {
  return { ref: ref, controlType: controlType, text: text, absX: 0, absY: 0, w: 10, h: 10 }
}

const CONTROLS = [control("1:9", "IconButton", "确定"), control("1:10", "IconButton"), control("1:11", "TextBlock", "标题")]
const GROUPS: LayoutGroup[] = [{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }]

/* 一份推导结果（分区 → 行/列 → 格子 + 没归宿的那几条），与视图用例里那份同形。 */
const DERIVED: DerivedLayout = {
  available: true,
  reason: "",
  regions: [
    { id: "top-strip", name: "顶部栏", emit: false, cells: [] },
    {
      id: "work-area",
      name: "工作区",
      emit: true,
      cells: [
        { ref: "1:9", row: 1, column: 2, rowSpan: 1, columnSpan: 1 },
        { ref: "1:10", row: 1, column: 3, rowSpan: 1, columnSpan: 1 },
        { ref: "1:11", row: 2, column: 1, rowSpan: 1, columnSpan: 1 }
      ]
    }
  ],
  unresolved: [{ ref: "1:12", reason: "单条目栏：几何判不出它跟谁同组" }]
}

describe("layout-edit", () => {
  it("编号按清单次序，清单里没有的 ref 不编号、照原样显示", () => {
    expect(numberOf(CONTROLS, "1:9")).toBe(1)
    expect(numberOf(CONTROLS, "1:11")).toBe(3)
    expect(numberOf(CONTROLS, "9:9")).toBe(0)
    expect(labelOf(CONTROLS, "1:9")).toBe("#1 IconButton · 确定")
    expect(labelOf(CONTROLS, "1:10")).toBe("#2 IconButton")
    expect(labelOf(CONTROLS, "9:9")).toBe("9:9")
  })

  it("控件的展示名：value 优先，没有 value 退回控件类型，清单里没有的给 ref", () => {
    expect(displayNameOf(CONTROLS, "1:9")).toBe("确定")
    expect(displayNameOf(CONTROLS, "1:10")).toBe("IconButton")
    expect(displayNameOf(CONTROLS, "9:9")).toBe("9:9")
    // 只有空白的 value 当没有。
    expect(displayNameOf([control("1:12", "IconButton", "   ")], "1:12")).toBe("IconButton")
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

/* 树上那一行的 key 怎么拼、怎么解回要描的控件：断言的是 key 的拼法契约本身。 */
describe("refsOfDerived", () => {
  it("四种 key：整个分区 / 分区里的一行 / 单个控件 / 没归宿", () => {
    expect(refsOfDerived(DERIVED, "region:work-area")).toEqual(["1:9", "1:10", "1:11"])
    expect(refsOfDerived(DERIVED, "region:work-area#row:1")).toEqual(["1:9", "1:10"])
    expect(refsOfDerived(DERIVED, "region:work-area#row:2")).toEqual(["1:11"])
    expect(refsOfDerived(DERIVED, "region:top-strip")).toEqual([])
    expect(refsOfDerived(DERIVED, "ref:1:9")).toEqual(["1:9"])
    // 控件行带「分区 + 行」前缀（跨行的格子每行一条），解析时只看最后一段。
    expect(refsOfDerived(DERIVED, "region:work-area#row:1/ref:1:9")).toEqual(["1:9"])
    expect(refsOfDerived(DERIVED, "unresolved")).toEqual(["1:12"])
    // 空 key / 认不出的分区 / 还没有读数：都描不出东西。
    expect(refsOfDerived(DERIVED, "")).toEqual([])
    expect(refsOfDerived(DERIVED, "region:nope")).toEqual([])
    expect(refsOfDerived(null, "region:work-area")).toEqual([])
  })

  it("跨行的格子：它盖住的每一行都算有它", () => {
    const spanning: DerivedLayout = {
      available: true,
      reason: "",
      regions: [
        {
          id: "work-area",
          name: "工作区",
          emit: true,
          cells: [{ ref: "1:9", row: 2, column: 1, rowSpan: 2, columnSpan: 1 }]
        }
      ],
      unresolved: []
    }
    expect(refsOfDerived(spanning, "region:work-area#row:1")).toEqual([])
    expect(refsOfDerived(spanning, "region:work-area#row:2")).toEqual(["1:9"])
    expect(refsOfDerived(spanning, "region:work-area#row:3")).toEqual(["1:9"])
  })
})
