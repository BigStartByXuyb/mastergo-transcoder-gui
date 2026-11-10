import { afterEach, describe, expect, it } from "vitest"

import {
  AUTOMATION_LABEL,
  MODE_HINT,
  adoptsIdentityWithoutConfirm,
  modeTakesRoute,
  readTaskForm,
  startActionLabel,
  writeTaskForm
} from "@/lib/task-form"

afterEach(() => {
  localStorage.clear()
})

describe("task-form", () => {
  it("没存过时给缺省表单（路线默认 A）", () => {
    expect(readTaskForm()).toEqual({
      link: "",
      projectRoot: "",
      target: "",
      ui: "",
      mode: "A",
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
    expect(readTaskForm().mode).toBe("A")
    localStorage.setItem("mastergo-transcoder-gui.pipeline", "[1,2,3]")
    expect(readTaskForm().link).toBe("")
  })

  it("路线文案与自动化层级文案各有一份", () => {
    expect(MODE_HINT.A).toContain("MW WPF")
    expect(MODE_HINT.AB).toContain("两次独立运行")
    expect(AUTOMATION_LABEL.off).toContain("不叫模型")
  })

  it("只有「自动」层级才不人工确认地采用身份候选", () => {
    expect(adoptsIdentityWithoutConfirm("auto")).toBe(true)
    expect(adoptsIdentityWithoutConfirm("assist")).toBe(false)
    expect(adoptsIdentityWithoutConfirm("off")).toBe(false)
  })

  it("哪一版走哪条路线：单条按名字对上，AB 两条都算", () => {
    expect(modeTakesRoute("A", "A")).toBe(true)
    expect(modeTakesRoute("A", "B")).toBe(false)
    expect(modeTakesRoute("B", "B")).toBe(true)
    expect(modeTakesRoute("AB", "A")).toBe(true)
    expect(modeTakesRoute("AB", "B")).toBe(true)
    expect(modeTakesRoute("", "A")).toBe(false)
  })

  it("创建按钮对 A、AB 用同一句启动文案", () => {
    expect(startActionLabel("A")).toBe("创建并开始")
    expect(startActionLabel("AB")).toBe("创建并开始")
    expect(startActionLabel("B")).toBe("加入看板并开始")
  })
})
