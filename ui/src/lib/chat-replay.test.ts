import { describe, expect, it } from "vitest"

import { replayConversation, upsertTurn } from "@/lib/chat-replay"
import type { ChatTurn } from "@/lib/api"

const item = (id: string, text: string) => '{"type":"item.completed","item":{"id":"' + id + '","type":"agent_message","text":"' + text + '"}}'

describe("upsertTurn", () => {
  it("同一轮里按 id 原地更新", () => {
    const after = upsertTurn([{ kind: "you", text: "问" }], {
      kind: "command",
      itemId: "item_0",
      command: "ls",
      output: "a",
      exitCode: 0,
      running: false
    })
    const again = upsertTurn(after, {
      kind: "command",
      itemId: "item_0",
      command: "ls",
      output: "b",
      exitCode: 1,
      running: false
    })
    expect(again).toHaveLength(2)
    expect(again[1]).toMatchObject({ kind: "agent", item: { output: "b", exitCode: 1 } })
  })

  // 引擎的 item id 每轮从 item_0 重来：跨轮去匹配会改掉上一轮的同名条目。
  it("跨轮不串", () => {
    const turns = [
      { kind: "you" as const, text: "第一问" },
      { kind: "agent" as const, item: { kind: "message" as const, itemId: "item_0", text: "第一答" } },
      { kind: "you" as const, text: "第二问" }
    ]
    const next = upsertTurn(turns, { kind: "message", itemId: "item_0", text: "第二答" })
    expect(next).toHaveLength(4)
    expect(next[1]).toMatchObject({ item: { text: "第一答" } })
    expect(next[3]).toMatchObject({ item: { text: "第二答" } })
  })
})

describe("replayConversation", () => {
  const turns: ChatTurn[] = [
    {
      at: "2026-09-30T01:00:00.000Z",
      prompt: "看一下 F1",
      exitCode: 0,
      finished: true,
      lines: [
        { stream: "stdout", line: '{"type":"thread.started","thread_id":"t-abc"}' },
        { stream: "stderr", line: "Reading additional input from stdin..." },
        { stream: "stdout", line: item("item_0", "停在第 7 步") }
      ]
    }
  ]

  it("重放出提问、条目与引擎日志，并给出续跑 id", () => {
    const replayed = replayConversation(turns)
    expect(replayed.thread).toBe("t-abc")
    // 顺序就是原始行顺序：先 thread.started，再正文，最后挂这一轮的日志。
    expect(replayed.turns.map((turn) => turn.kind)).toEqual(["you", "agent", "agent", "log"])
    expect(replayed.turns[0]).toEqual({ kind: "you", text: "看一下 F1" })
    expect(replayed.turns[1]).toMatchObject({ item: { kind: "thread", threadId: "t-abc" } })
    expect(replayed.turns[2]).toMatchObject({ item: { kind: "message", text: "停在第 7 步" } })
    // 正常收尾（退出码 0）的日志收着。
    expect(replayed.turns[3]).toMatchObject({ kind: "log", open: false })
  })

  it("没收尾的那一轮日志默认铺开", () => {
    const broken: ChatTurn[] = [
      { at: "x", prompt: "跑", exitCode: 2, finished: true, lines: [{ stream: "stderr", line: "boom" }] }
    ]
    expect(replayConversation(broken).turns[1]).toMatchObject({ kind: "log", open: true })
  })

  it("没有对话就是空的", () => {
    expect(replayConversation([])).toEqual({ turns: [], thread: "" })
  })
})
