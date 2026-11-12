import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { TaskDetailCard } from "@/app/task-detail-card"
import type { BoardTask } from "@/lib/api"
import { drive } from "@/lib/settings-fixtures"

function task(patch: Partial<BoardTask> = {}): BoardTask {
  return {
    id: "task-1",
    createdAt: "",
    updatedAt: "",
    state: "waiting",
    stateLabel: "待确认",
    request: {
      mode: "A",
      link: "",
      target: "DemoPage",
      ui: "F7",
      projectRoot: drive("D", "project"),
      fileId: "",
      layerId: "",
      stopAfter: "",
      overwrite: false
    },
    jobId: "",
    workDir: drive("D", "work", "task-1"),
    routes: ["A"],
    autoMerge: false,
    deferStart: false,
    progress: null,
    steps: [],
    resumable: false,
    resumeStep: "",
    layoutStep: "discover",
    aiFills: [],
    failure: {
      kind: "semantic",
      stepName: "discover",
      title: "候选发现",
      message: "含 A 的路线需要页面 PNG",
      logPath: ""
    },
    merge: null,
    resolutions: {},
    error: "",
    designImage: "",
    ...patch
  }
}

function show(value: BoardTask, onResume = vi.fn()) {
  render(
    <TaskDetailCard
      task={value}
      contractStep={null}
      stopStepNumber={0}
      allStepsDone={false}
      busy=""
      onResume={onResume}
      onMerge={() => {}}
      onResolve={async () => {}}
    />
  )
  return onResume
}

describe("TaskDetailCard 的续跑入口", () => {
  it("页面 PNG 停点不给续跑按钮", () => {
    show(task())
    expect(screen.queryByRole("button", { name: "重跑一遍" })).toBeNull()
    expect(screen.queryByRole("button", { name: "从断点继续" })).toBeNull()
  })

  it("可续跑时按钮只按快照的断点名决定措辞", () => {
    const onResume = show(task({ resumable: true, resumeStep: "候选发现" }))
    fireEvent.click(screen.getByRole("button", { name: "从断点继续" }))
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it("没有断点但允许续跑时从起点重跑", () => {
    show(task({ resumable: true, resumeStep: "" }))
    expect(screen.getByRole("button", { name: "重跑一遍" })).toBeTruthy()
  })
})
