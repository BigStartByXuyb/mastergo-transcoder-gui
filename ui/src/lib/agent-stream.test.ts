import { describe, expect, it } from "vitest"

import { parseAgentStreamLine, readCodexLine, upsertItem, type AgentItem } from "@/lib/agent-stream"

describe("传输报文", () => {
  it("开的哪条对话先说，引擎再说这次用的是哪一份", () => {
    expect(parseAgentStreamLine('{"ok":true,"conversation":{"id":"c1","title":"看一下 F1"}}')).toEqual({
      kind: "conversation",
      id: "c1",
      title: "看一下 F1"
    })
    expect(parseAgentStreamLine('{"ok":true,"engine":{"version":"0.159.0","source":"managed","state":"verified"}}')).toEqual({
      kind: "engine",
      version: "0.159.0",
      source: "managed",
      state: "verified"
    })
  })

  it("stdout / stderr 都按行带出来", () => {
    expect(parseAgentStreamLine('{"ok":true,"stream":"stderr","line":"boom"}')).toEqual({
      kind: "line",
      stream: "stderr",
      line: "boom"
    })
    expect(parseAgentStreamLine('{"ok":true,"line":"hello"}')).toEqual({ kind: "line", stream: "stdout", line: "hello" })
  })

  it("退出码与失败各占一条", () => {
    expect(parseAgentStreamLine('{"ok":true,"exit":0}')).toEqual({ kind: "exit", code: 0 })
    expect(parseAgentStreamLine('{"ok":false,"error":{"code":"NO_CODEX","message":"没得用","hint":"去下载"}}')).toEqual({
      kind: "failure",
      code: "NO_CODEX",
      message: "没得用",
      hint: "去下载"
    })
  })

  it("半行、脏数据、非成功报文一律丢掉", () => {
    expect(parseAgentStreamLine("")).toBeNull()
    expect(parseAgentStreamLine("{半行")).toBeNull()
    expect(parseAgentStreamLine('{"ok":true}')).toBeNull()
    expect(parseAgentStreamLine('{"ok":false}')).toEqual({
      kind: "failure",
      code: "",
      message: "Codex 这一步没跑起来",
      hint: ""
    })
  })
})

describe("codex 自己的输出", () => {
  it("agent_message 是正文", () => {
    expect(readCodexLine('{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"看完了"}}')).toEqual({
      kind: "message",
      itemId: "item_3",
      text: "看完了"
    })
  })

  // 实测：item.started 就带着命令与 status=in_progress，退出码还是 null。
  it("命令一开始就能显示，不必等它跑完", () => {
    expect(
      readCodexLine(
        '{"type":"item.started","item":{"id":"item_2","type":"command_execution","command":"ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}'
      )
    ).toEqual({ kind: "command", itemId: "item_2", command: "ls", output: "", exitCode: null, running: true })
    expect(
      readCodexLine(
        '{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"ls","aggregated_output":"a\\nb","exit_code":0,"status":"completed"}}'
      )
    ).toEqual({ kind: "command", itemId: "item_2", command: "ls", output: "a\nb", exitCode: 0, running: false })
  })

  it("文件改动带路径与动作", () => {
    expect(
      readCodexLine(
        '{"type":"item.completed","item":{"id":"item_4","type":"file_change","changes":[{"path":"a.ts","kind":"update"},{"path":"b.ts","kind":"add"}],"status":"completed"}}'
      )
    ).toEqual({
      kind: "fileChange",
      itemId: "item_4",
      running: false,
      changes: [
        { path: "a.ts", action: "update" },
        { path: "b.ts", action: "add" }
      ]
    })
  })

  it("MCP 工具调用与联网搜索各有各的条目", () => {
    expect(
      readCodexLine(
        '{"type":"item.completed","item":{"id":"item_5","type":"mcp_tool_call","server":"mastergo","tool":"getDsl","arguments":{"id":1},"result":"ok"}}'
      )
    ).toEqual({ kind: "tool", itemId: "item_5", server: "mastergo", tool: "getDsl", args: '{"id":1}', output: "ok", running: false })
    expect(
      readCodexLine('{"type":"item.completed","item":{"id":"item_6","type":"web_search","query":"codex exec json"}}')
    ).toEqual({ kind: "search", itemId: "item_6", query: "codex exec json", running: false })
  })

  it("思考过程也收成条目", () => {
    expect(readCodexLine('{"type":"item.completed","item":{"id":"item_7","type":"reasoning","text":"先看日志"}}')).toEqual({
      kind: "reasoning",
      itemId: "item_7",
      text: "先看日志",
      running: false
    })
  })

  it("线程开始与一轮结束也有记录", () => {
    expect(readCodexLine('{"type":"thread.started","thread_id":"t1"}')).toEqual({
      kind: "thread",
      itemId: "thread",
      threadId: "t1"
    })
    // 实测没有 total_tokens，只有分项：合计在这里算。
    expect(
      readCodexLine('{"type":"turn.completed","usage":{"input_tokens":161104,"output_tokens":116,"reasoning_output_tokens":68}}')
    ).toEqual({ kind: "turn", itemId: "turn", tokens: 161220 })
    expect(readCodexLine('{"type":"turn.completed","usage":{"total_tokens":42}}')).toEqual({
      kind: "turn",
      itemId: "turn",
      tokens: 42
    })
    expect(readCodexLine('{"type":"turn.completed"}')).toEqual({ kind: "turn", itemId: "turn", tokens: null })
  })

  it("一轮失败只有 turn.failed 这一种写法", () => {
    expect(readCodexLine('{"type":"turn.failed","error":{"message":"模型拒了"}}')).toEqual({
      kind: "failure",
      itemId: "turn.failed",
      text: "模型拒了"
    })
  })

  it("引擎自己报的错都算提示，跑没跑完由收尾定", () => {
    expect(readCodexLine('{"type":"item.completed","item":{"id":"item_0","type":"error","message":"单步失败"}}')).toEqual({
      kind: "notice",
      itemId: "item_0",
      text: "单步失败"
    })
    expect(readCodexLine('{"type":"error","message":"Reconnecting... waiting for network"}')).toMatchObject({
      kind: "notice",
      text: "Reconnecting... waiting for network"
    })
  })

  it("不认识的类型与非 JSON 不变成条目", () => {
    expect(readCodexLine("plain text")).toBeNull()
    expect(readCodexLine("{坏")).toBeNull()
    expect(readCodexLine('{"type":"item.completed","item":{"id":"i","type":"todo_list"}}')).toBeNull()
    expect(readCodexLine('{"type":"turn.failed"}')).toEqual({
      kind: "failure",
      itemId: "turn.failed",
      text: "这次提问没有跑完"
    })
  })
})

describe("同一条目按 id 原地更新", () => {
  const started: AgentItem = {
    kind: "command",
    itemId: "item_2",
    command: "ls",
    output: "",
    exitCode: null,
    running: true
  }

  it("started 换成 completed 只占一行", () => {
    const done: AgentItem = { kind: "command", itemId: "item_2", command: "ls", output: "a", exitCode: 0, running: false }
    const list = upsertItem([started], done)
    expect(list).toHaveLength(1)
    expect(list[0]).toEqual(done)
  })

  it("没见过的一律追加在后面", () => {
    const other: AgentItem = { kind: "message", itemId: "item_3", text: "好了" }
    expect(upsertItem([started], other).map((item) => item.itemId)).toEqual(["item_2", "item_3"])
  })
})
