import { describe, expect, it } from "vitest"

import type { AgentItem } from "@/lib/agent-stream"
import { groupSteps, isStep } from "@/lib/chat-blocks"
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

