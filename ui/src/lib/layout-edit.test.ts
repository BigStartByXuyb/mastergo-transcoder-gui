import { describe, expect, it } from "vitest"

import {
  addGroup,
  displayNameOf,
  labelOf,
  moveMember,
  numberOf,
  removeGroup,
  removeMember,
  treeLinesOf,
  ungroupedControls
} from "@/lib/layout-edit"
import { bands, cell } from "@/lib/layout-fixtures"
import type { DerivedLayout, LayoutControl, LayoutGroup } from "@/lib/api"

/*
 * 布局确认面板的纯逻辑：编号、控件怎么认、未分组清单、分组的增删改，以及布局树那几行怎么算
 * （树长什么样、点一行要描哪些控件）。写回校验的判据在后端，这里不重复；
 * 树上摆成什么样子由 ui/src/app/layout-tree.test.tsx 直接验。
 */

function control(ref: string, controlType = "IconButton", text = ""): LayoutControl {
  return { ref: ref, controlType: controlType, text: text, absX: 0, absY: 0, w: 10, h: 10, citable: true }
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

/*
 * 树上的每一行（分区 → 组 → 控件，加上树下面那两块读数）：断言的是每一行盖住哪些控件
 * （面板据此把选中的 key 翻成画布上要描的控件），以及「这一步没跑过」时一行都不给。
 */
describe("treeLinesOf", () => {
  const CONTROLS = [control("1:9", "IconButton", "确定"), control("1:10", "IconButton", "取消")]
  const DERIVED: DerivedLayout = {
    available: true,
    reason: "",
    regions: [
      { id: "top-strip", name: "顶部栏", emit: false, bands: bands(0, 0), cells: [] },
      {
        id: "work-area",
        name: "工作区",
        emit: true,
        bands: bands(2, 2, [2], [2]),
        cells: [
          cell("1:9", "IconButton"),
          cell("9:1", "", [cell("9:2", "NumberBox"), cell("9:3", "TextBlock")], "column", bands(1, 2, [], [2]))
        ]
      }
    ],
    unplaced: [{ ref: "1:11", reason: "推导产物里这一格没有行列坐标" }],
    singles: [{ ref: "1:10", reason: "单条目栏：几何判不出它跟谁同组" }]
  }

  it("每行都给 key / 缩进 / 文案，并带上它盖住的控件", () => {
    const lines = treeLinesOf(DERIVED, CONTROLS)
    const hitOf = (label: string) => lines.find((line) => line.label === label)?.hit

    expect(lines.map((line) => [line.kind, line.depth, line.label])).toEqual([
      ["region", 0, "顶部栏 · 只注册"],
      ["region", 0, "工作区 · 发射 · 2 行 × 2 列 · 第 2 行、第 2 列吃剩余（*）"],
      ["control", 1, "#1 确定"],
      ["group", 1, "组 1（垂直布局） · 第 2 列吃剩余（*）"],
      ["control", 2, "NumberBox"],
      ["control", 2, "TextBlock"],
      ["extra", 1, "摆不进树的 1 个"],
      ["extra", 1, "插件报的单条目栏 · 1 个"]
    ])

    expect(hitOf("工作区 · 发射 · 2 行 × 2 列 · 第 2 行、第 2 列吃剩余（*）")).toEqual([
      "1:9", "9:1", "9:2", "9:3"
    ])
    // 组：这一组里全部的控件（含它自己与套着的几层）。
    expect(hitOf("组 1（垂直布局） · 第 2 列吃剩余（*）")).toEqual(["9:1", "9:2", "9:3"])
    expect(hitOf("#1 确定")).toEqual(["1:9"])
    expect(hitOf("TextBlock")).toEqual(["9:3"])
    // 两块读数：它们不在树里，各自的 ref 与原因照样交出来。
    expect(hitOf("摆不进树的 1 个")).toEqual(["1:11"])
    expect(hitOf("插件报的单条目栏 · 1 个")).toEqual(["1:10"])
    expect(lines.filter((line) => line.kind === "extra")[1].items).toEqual([
      { ref: "1:10", label: "#2 取消", reason: "单条目栏：几何判不出它跟谁同组" }
    ])
    // key 是这一行的身份：两两不同。
    const keys = lines.map((line) => line.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("没有产物 / 还没读到：一行都不给（面板据此算不出高亮，也就不会描错）", () => {
    expect(treeLinesOf(null, CONTROLS)).toEqual([])
    expect(treeLinesOf({ available: false, reason: "还没跑", regions: [], unplaced: [], singles: [] }, CONTROLS)).toEqual([])
  })
})
