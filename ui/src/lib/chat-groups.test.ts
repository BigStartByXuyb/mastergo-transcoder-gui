import { describe, expect, it } from "vitest"

import { groupByProjectRoot, projectLabel } from "@/lib/chat-groups"
import type { ChatSummary } from "@/lib/api"

function chat(patch: Partial<ChatSummary>): ChatSummary {
  return {
    id: patch.id ?? "c1",
    title: patch.title ?? "标题",
    agent: patch.agent ?? "",
    projectRoot: patch.projectRoot ?? "",
    createdAt: patch.createdAt ?? "2026-09-30T00:00:00.000Z",
    updatedAt: patch.updatedAt ?? "2026-09-30T00:00:00.000Z",
    turnCount: patch.turnCount ?? 1
  }
}

describe("groupByProjectRoot", () => {
  it("同一个工程的对话归一段，段之间按目录名排序", () => {
    const groups = groupByProjectRoot([
      chat({ id: "a", projectRoot: "/proj/b" }),
      chat({ id: "b", projectRoot: "/proj/a" }),
      chat({ id: "c", projectRoot: "/proj/b" })
    ])
    expect(groups.map((group) => group.projectRoot)).toEqual(["/proj/a", "/proj/b"])
    expect(groups[1].chats.map((item) => item.id)).toEqual(["a", "c"])
  })

  it("没绑工程的排最后一段，且同段里保持原顺序", () => {
    const groups = groupByProjectRoot([
      chat({ id: "x", projectRoot: "" }),
      chat({ id: "y", projectRoot: "/proj/a" }),
      chat({ id: "z", projectRoot: "" })
    ])
    expect(groups.map((group) => group.projectRoot)).toEqual(["/proj/a", ""])
    expect(groups[1].chats.map((item) => item.id)).toEqual(["x", "z"])
  })

  it("没有对话就是空表", () => {
    expect(groupByProjectRoot([])).toEqual([])
  })
})

describe("projectLabel", () => {
  it("没绑工程的那一段有名字", () => {
    expect(projectLabel("")).toBe("未绑工程目录")
    expect(projectLabel("/proj/a")).toBe("/proj/a")
  })
})
