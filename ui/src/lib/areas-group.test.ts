import { describe, expect, it } from "vitest"

import type { BoardTask } from "@/lib/api"
import { buildAreas, groupByProject, projectHasTasks } from "@/lib/areas"

function task(id: string, projectRoot: string, ui: string): BoardTask {
  return {
    id,
    state: "merged",
    stateLabel: "",
    request: { projectRoot, ui, target: "T", mode: "A" },
    steps: []
  } as unknown as BoardTask
}

describe("groupByProject", () => {
  it("按工程分组，并给出「这个工程还有没有任务」", () => {
    const areas = buildAreas({
      projects: ["/b", "/a"],
      pagesByProject: { "/a": [{ target: "F1", ui: "F1", layerId: "1:1", designPageName: "" }] },
      tasks: [task("t1", "/b", "HH")]
    })
    const groups = groupByProject(areas)
    expect(groups.map((group) => group.projectRoot)).toEqual(["/a", "/b"])
    expect(groups[0].hasTasks).toBe(false)
    expect(groups[1].hasTasks).toBe(true)
    expect(groups[1].areas.map((area) => area.ui)).toEqual(["HH"])
  })

  it("没有区域时是空分组列表", () => {
    expect(groupByProject([])).toEqual([])
  })

  it("「这个工程还有没有任务」只有一处判定，视图与动作共用", () => {
    const areas = buildAreas({
      projects: ["/a", "/b"],
      pagesByProject: { "/a": [{ target: "F1", ui: "F1", layerId: "1:1", designPageName: "" }] },
      tasks: [task("t1", "/b", "HH")]
    })
    expect(projectHasTasks(areas, "/a")).toBe(false)
    expect(projectHasTasks(areas, "/b")).toBe(true)
    expect(projectHasTasks(areas, " /b ")).toBe(true)
    expect(projectHasTasks(areas, "")).toBe(false)
  })
})
