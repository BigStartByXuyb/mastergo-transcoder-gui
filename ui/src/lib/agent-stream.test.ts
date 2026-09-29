import { describe, expect, it } from "vitest"

import { parseAgentStreamLine, readCodexLine } from "@/lib/agent-stream"

describe("传输报文", () => {
  it("引擎那一行先说这次用的是哪一份", () => {
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
    expect(readCodexLine('{"type":"item.completed","item":{"type":"agent_message","text":"看完了"}}')).toEqual({
      kind: "message",
      text: "看完了"
    })
  })

  it("command_execution 带命令、输出与退出码", () => {
    expect(
      readCodexLine(
        '{"type":"item.completed","item":{"type":"command_execution","command":"ls","aggregated_output":"a\\nb","exit_code":0}}'
      )
    ).toEqual({ kind: "command", command: "ls", output: "a\nb", exitCode: 0 })
  })

  it("线程开始与一轮结束也有记录", () => {
    expect(readCodexLine('{"type":"thread.started","thread_id":"t1"}')).toEqual({ kind: "thread", id: "t1" })
    expect(readCodexLine('{"type":"turn.completed","usage":{"total_tokens":42}}')).toEqual({ kind: "turn", tokens: 42 })
    expect(readCodexLine('{"type":"turn.completed"}')).toEqual({ kind: "turn", tokens: null })
  })

  it("一轮失败只有 turn.failed 这一种写法", () => {
    expect(readCodexLine('{"type":"turn.failed","error":{"message":"模型拒了"}}')).toEqual({
      kind: "failure",
      text: "模型拒了"
    })
  })

  it("引擎自己报的错都算提示，跑没跑完由收尾定", () => {
    expect(readCodexLine('{"type":"item.completed","item":{"type":"error","message":"单步失败"}}')).toEqual({
      kind: "notice",
      text: "单步失败"
    })
    expect(readCodexLine('{"type":"error","message":"Reconnecting... waiting for network"}')).toEqual({
      kind: "notice",
      text: "Reconnecting... waiting for network"
    })
  })

  it("不认识的类型与非 JSON 不变成条目", () => {
    expect(readCodexLine("plain text")).toBeNull()
    expect(readCodexLine("{坏")).toBeNull()
    expect(readCodexLine('{"type":"item.started","item":{"type":"reasoning"}}')).toBeNull()
    expect(readCodexLine('{"type":"item.completed","item":{"type":"reasoning"}}')).toBeNull()
    expect(readCodexLine('{"type":"turn.failed"}')).toEqual({ kind: "failure", text: "这次提问没有跑完" })
  })
})
