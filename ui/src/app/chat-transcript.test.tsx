import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ChatTranscript, type Turn } from "@/app/chat-transcript"

function show(turns: Turn[]) {
  render(<ChatTranscript turns={turns} />)
}

describe("ChatTranscript", () => {
  it("正文与提问各自成条", () => {
    show([
      { kind: "you", text: "F1 生成到哪一步了" },
      { kind: "agent", item: { kind: "message", text: "停在第 7 步" } }
    ])
    expect(screen.getByText("F1 生成到哪一步了")).toBeTruthy()
    expect(screen.getByText("停在第 7 步")).toBeTruthy()
  })

  it("非致命提示按浅色一行给，不弹报错卡片", () => {
    show([{ kind: "agent", item: { kind: "notice", text: "Model metadata for `deepseek-chat` not found." } }])
    expect(screen.getByText("Model metadata for `deepseek-chat` not found.")).toBeTruthy()
    expect(screen.queryByText("Codex 报错")).toBeNull()
  })

  it("真失败才出报错卡片", () => {
    show([{ kind: "agent", item: { kind: "failure", text: "模型拒了" } }])
    expect(screen.getByText("Codex 报错")).toBeTruthy()
    expect(screen.getByText("模型拒了")).toBeTruthy()
  })

  it("命令条目带退出码与输出", () => {
    show([{ kind: "agent", item: { kind: "command", command: "Get-Date", output: "2026-09-30", exitCode: 1 } }])
    expect(screen.getByText("Get-Date")).toBeTruthy()
    expect(screen.getByText("exit 1")).toBeTruthy()
    expect(screen.getByText("2026-09-30")).toBeTruthy()
  })

  it("引擎日志默认收着，点按钮才铺开", () => {
    show([{ kind: "log", text: "Reading additional input from stdin...\n", open: false }])
    expect(screen.getByText("引擎日志（1 行）")).toBeTruthy()
    expect(screen.queryByText(/Reading additional input/)).toBeNull()
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText(/Reading additional input/)).toBeTruthy()
  })

  it("收尾不干净时日志直接铺开", () => {
    show([{ kind: "log", text: "boom\n", open: true }])
    expect(screen.getByText("引擎日志（1 行）")).toBeTruthy()
    expect(screen.getByText(/boom/)).toBeTruthy()
  })

  it("没有日志就不出现这一块", () => {
    show([])
    expect(screen.queryByText(/引擎日志/)).toBeNull()
    expect(screen.getByText("还没有对话。")).toBeTruthy()
  })

  it("空内容的日志条目不占位", () => {
    show([{ kind: "log", text: "\n", open: true }])
    expect(screen.queryByText(/引擎日志/)).toBeNull()
  })

  it("每一轮的日志各留各的", () => {
    show([
      { kind: "you", text: "第一问" },
      { kind: "agent", item: { kind: "message", text: "第一答" } },
      { kind: "log", text: "第一轮噪音\n", open: false },
      { kind: "you", text: "第二问" },
      { kind: "agent", item: { kind: "message", text: "第二答" } },
      { kind: "log", text: "第二轮噪音\n", open: false }
    ])
    expect(screen.getAllByText("引擎日志（1 行）")).toHaveLength(2)
  })
})
