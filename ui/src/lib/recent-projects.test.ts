import { afterEach, describe, expect, it } from "vitest"

import { forgetProject, readRecentProjects, rememberProject } from "@/lib/recent-projects"

afterEach(() => {
  localStorage.clear()
})

describe("recent-projects", () => {
  it("没存过时是空列表", () => {
    expect(readRecentProjects()).toEqual([])
  })

  it("记住的工程排在最前，重复的只留一条", () => {
    rememberProject("/a")
    rememberProject("/b")
    expect(readRecentProjects()).toEqual(["/b", "/a"])
    rememberProject("/a")
    expect(readRecentProjects()).toEqual(["/a", "/b"])
  })

  it("空工程名不记，忘了就真没了", () => {
    rememberProject("   ")
    expect(readRecentProjects()).toEqual([])
    rememberProject("/a")
    expect(forgetProject("/a")).toEqual([])
  })

  it("最多记 8 个：老的自动挤掉", () => {
    for (let i = 0; i < 11; i += 1) rememberProject("/p" + i)
    const list = readRecentProjects()
    expect(list).toHaveLength(8)
    expect(list[0]).toBe("/p10")
  })

  it("存的是坏结构时退回空列表", () => {
    localStorage.setItem("mastergo-transcoder-gui.projects", JSON.stringify({ projects: "不是数组" }))
    expect(readRecentProjects()).toEqual([])
  })
})
