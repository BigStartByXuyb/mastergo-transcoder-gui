import { describe, expect, it } from "vitest"

import type { AgentItem } from "@/lib/agent-stream"
import { groupSteps, isStep, leadFlags } from "@/lib/chat-blocks"
import type { Turn } from "@/app/chat-transcript"

const command = (id: string): AgentItem => ({
  kind: "command",
  itemId: id,
  command: "ls",
  output: "",
  exitCode: 0,
  running: false
})
const message = (id: string, text: string): AgentItem => ({ kind: "message", itemId: id, text })

describe("groupSteps", () => {
  it("过程类条目算一步，正文不算", () => {
    expect(isStep(command("a"))).toBe(true)
    expect(isStep({ kind: "fileChange", itemId: "b", changes: [], running: false })).toBe(true)
    expect(isStep({ kind: "reasoning", itemId: "c", text: "", running: false })).toBe(true)
    expect(isStep(message("d", "hi"))).toBe(false)
    expect(isStep({ kind: "turn", itemId: "turn", tokens: 1 })).toBe(false)
  })

  it("连着的过程合成一组，正文把它切开", () => {
    const turns: Turn[] = [
      { kind: "you", text: "问" },
      { kind: "agent", item: command("a") },
      { kind: "agent", item: command("b") },
      { kind: "agent", item: message("c", "先看这两个") },
      { kind: "agent", item: command("d") }
    ]
    const blocks = groupSteps(turns)
    expect(blocks.map((block) => block.kind)).toEqual(["single", "steps", "single", "steps"])
    const first = blocks[1]
    expect(first.kind === "steps" && first.items.length).toBe(2)
    const last = blocks[3]
    expect(last.kind === "steps" && last.items.length).toBe(1)
  })

  it("一上来就是过程、结尾也是过程，都不会掉", () => {
    const blocks = groupSteps([
      { kind: "agent", item: command("a") },
      { kind: "log", text: "噪音", open: false },
      { kind: "agent", item: command("b") }
    ])
    expect(blocks.map((block) => block.kind)).toEqual(["steps", "single", "steps"])
  })

  it("没有条目就是空的", () => {
    expect(groupSteps([])).toEqual([])
  })
})

describe("leadFlags", () => {
  const you = (text: string): Turn => ({ kind: "you", text })

  it("每一轮的第一个正文都带头像", () => {
    const turns: Turn[] = [
      you("第一问"),
      { kind: "agent", item: message("a", "第一答") },
      { kind: "agent", item: message("b", "补充") },
      you("第二问"),
      { kind: "agent", item: message("c", "第二答") }
    ]
    expect(leadFlags(groupSteps(turns))).toEqual([false, true, false, false, true])
  })

  it("一轮里先跑命令再说话，头像挂在正文上", () => {
    const turns: Turn[] = [you("问"), { kind: "agent", item: command("a") }, { kind: "agent", item: message("b", "答") }]
    expect(leadFlags(groupSteps(turns))).toEqual([false, false, true])
  })

  it("一轮里只有动作没说话，头像挂在过程组上", () => {
    const turns: Turn[] = [you("问"), { kind: "agent", item: command("a") }, you("又问"), { kind: "agent", item: command("b") }]
    expect(leadFlags(groupSteps(turns))).toEqual([false, true, false, true])
  })

  it("你还没说话时它先开口的那一轮也带头像", () => {
    const turns: Turn[] = [{ kind: "agent", item: message("a", "开场") }]
    expect(leadFlags(groupSteps(turns))).toEqual([true])
  })

  it("只有日志时不挂头像", () => {
    expect(leadFlags(groupSteps([{ kind: "log", text: "噪音", open: false }]))).toEqual([false])
  })
})

