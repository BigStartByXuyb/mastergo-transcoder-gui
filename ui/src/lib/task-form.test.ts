import { afterEach, describe, expect, it } from "vitest"

import { AUTOMATION_LABEL, MODE_HINT, readTaskForm, writeTaskForm } from "@/lib/task-form"

afterEach(() => {
  localStorage.clear()
})

describe("task-form", () => {
  it("没存过时给缺省表单（路线默认 B）", () => {
    expect(readTaskForm()).toEqual({
      link: "",
      projectRoot: "",
      target: "",
      ui: "",
      mode: "B",
      stopAfter: "",
      overwrite: false
    })
  })

  it("写完能原样读回，overwrite 只认真正的 true", () => {
    writeTaskForm({
      link: "https://mastergo.com/goto/x",
      projectRoot: "/project",
      target: "F1StopAdjust",
      ui: "F1",
      mode: "A",
      stopAfter: "discover",
      overwrite: true
    })
    expect(readTaskForm()).toEqual({
      link: "https://mastergo.com/goto/x",
      projectRoot: "/project",
      target: "F1StopAdjust",
      ui: "F1",
      mode: "A",
      stopAfter: "discover",
      overwrite: true
    })
  })

  it("存的是坏 JSON 或非对象时退回缺省，不抛异常", () => {
    localStorage.setItem("mastergo-transcoder-gui.pipeline", "{不是 JSON")
    expect(readTaskForm().mode).toBe("B")
    localStorage.setItem("mastergo-transcoder-gui.pipeline", "[1,2,3]")
    expect(readTaskForm().link).toBe("")
  })

  it("路线文案与自动化层级文案各有一份", () => {
    expect(MODE_HINT.A).toContain("MW WPF")
    expect(MODE_HINT.AB).toContain("两次独立运行")
    expect(AUTOMATION_LABEL.off).toContain("不叫模型")
  })
})
