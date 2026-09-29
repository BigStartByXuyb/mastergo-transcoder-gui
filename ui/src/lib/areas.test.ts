import { describe, expect, it } from "vitest"

import type { BoardTask } from "@/lib/api"
import { areaKey, areaLabel, buildAreas } from "@/lib/areas"

function task(patch: { id: string; projectRoot: string; ui: string; state?: string }): BoardTask {
  return {
    id: patch.id,
    createdAt: "",
    updatedAt: "",
    state: (patch.state ?? "merged") as BoardTask["state"],
    stateLabel: "",
    request: {
      mode: "A",
      link: "",
      target: "F1StopAdjust",
      ui: patch.ui,
      projectRoot: patch.projectRoot,
      fileId: "",
      layerId: "",
      stopAfter: "",
      overwrite: false
    },
    jobId: "",
    workDir: "",
    autoMerge: true,
    progress: null,
    steps: [],
    aiFills: [],
    failure: null,
    merge: null,
    error: ""
  } as unknown as BoardTask
}

describe("buildAreas", () => {
  it("工程 + 区域才是主键：两个工程各有 F1 时分成两条", () => {
    const areas = buildAreas({
      projects: ["/a", "/b"],
      pagesByProject: {},
      tasks: [task({ id: "t1", projectRoot: "/a", ui: "F1" }), task({ id: "t2", projectRoot: "/b", ui: "F1" })]
    })
    expect(areas.map((area) => area.key)).toEqual([areaKey("/a", "F1"), areaKey("/b", "F1")])
    expect(areas[0].tasks.map((item) => item.id)).toEqual(["t1"])
  })

  it("登记表里的页面按区域挂到对应条目上（没有任务的区域也要出现）", () => {
    const areas = buildAreas({
      projects: ["/a"],
      pagesByProject: {
        "/a": [
          { target: "F1StopAdjust", layerId: "1:2", designPageName: "停止调整", ui: "F1" },
          { target: "F3TargetTeaching", layerId: "1:3", designPageName: "目标示教", ui: "F3" }
        ]
      },
      tasks: []
    })
    expect(areas.map((area) => area.ui)).toEqual(["F1", "F3"])
    expect(areas[0].pages.map((page) => page.target)).toEqual(["F1StopAdjust"])
  })

  it("任务里的工程也会进列表；没页面也没任务的工程不占位子", () => {
    const areas = buildAreas({
      projects: ["/only-registry"],
      pagesByProject: { "/only-registry": [] },
      tasks: [task({ id: "t9", projectRoot: "/from-task", ui: "HH" })]
    })
    expect(areas.map((area) => area.key)).toEqual([areaKey("/from-task", "HH")])
  })

  it("正在跑的任务单独计数：一看就知道这个区域还占着位子", () => {
    const areas = buildAreas({
      projects: [],
      pagesByProject: {},
      tasks: [
        task({ id: "t1", projectRoot: "/a", ui: "F1", state: "running" }),
        task({ id: "t2", projectRoot: "/a", ui: "F1", state: "merged" })
      ]
    })
    expect(areas[0].running).toBe(1)
    expect(areas[0].tasks).toHaveLength(2)
  })

  it("空工程名不算条目，空工程也不占位子", () => {
    const areas = buildAreas({
      projects: ["", "/a"],
      pagesByProject: {},
      tasks: [task({ id: "t1", projectRoot: "", ui: "F1" })]
    })
    expect(areas).toEqual([])
  })

  it("区域显示名：没登记区域时给一个能点的名字", () => {
    expect(areaLabel("F1")).toBe("F1")
    expect(areaLabel("")).toBe("未定区域")
  })
})
