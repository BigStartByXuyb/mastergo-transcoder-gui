import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ChatTranscript, type Turn } from "@/app/chat-transcript"
import type { AgentItem } from "@/lib/agent-stream"

function show(turns: Turn[]) {
  render(<ChatTranscript turns={turns} agentName="Codex v0.159.0" />)
}

function agent(item: AgentItem): Turn {
  return { kind: "agent", item }
}

describe("ChatTranscript", () => {
  it("正文与提问各自成条", () => {
    show([
      { kind: "you", text: "F1 生成到哪一步了" },
      agent({ kind: "message", itemId: "item_0", text: "停在第 7 步" })
    ])
    expect(screen.getByText("F1 生成到哪一步了")).toBeTruthy()
    expect(screen.getByText("停在第 7 步")).toBeTruthy()
  })

  // 分组以后「轮序号」和「块序号」不是一回事：标识要挂在它第一次开口的那条正文上。
  it("先跑命令再说话时，AI 标识挂在正文上", () => {
    show([
      agent({ kind: "command", itemId: "item_0", command: "ls", output: "", exitCode: 0, running: false }),
      agent({ kind: "message", itemId: "item_1", text: "看完了" })
    ])
    expect(screen.getByText("调用过程 1 步")).toBeTruthy()
    expect(screen.getByText("AI")).toBeTruthy()
  })

  it("标识只出现在第一次开口那条上", () => {
    show([
      agent({ kind: "message", itemId: "item_0", text: "第一句" }),
      agent({ kind: "message", itemId: "item_1", text: "第二句" })
    ])
    expect(screen.getAllByText("AI")).toHaveLength(1)
  })

  it("非致命提示按浅色一行给，不弹报错卡片", () => {
    show([agent({ kind: "notice", itemId: "item_0", text: "Model metadata for `deepseek-chat` not found." })])
    expect(screen.getByText("Model metadata for `deepseek-chat` not found.")).toBeTruthy()
    expect(screen.queryByText("Codex 报错")).toBeNull()
  })

  it("真失败才出报错卡片", () => {
    show([agent({ kind: "failure", itemId: "turn.failed", text: "模型拒了" })])
    expect(screen.getByText("Codex 报错")).toBeTruthy()
    expect(screen.getByText("模型拒了")).toBeTruthy()
  })

  // 两折：过程先合成一条，点开才是每一步，再点开才看详情。
  it("过程先合成一条，点开才是每一步，再点开才看详情", () => {
    show([agent({ kind: "command", itemId: "item_0", command: "Get-Date", output: "2026-09-30", exitCode: 1, running: false })])
    expect(screen.getByText("调用过程 1 步")).toBeTruthy()
    expect(screen.queryByText("exit 1")).toBeNull()
    expect(screen.queryByText("2026-09-30")).toBeNull()
    fireEvent.click(screen.getByText("调用过程 1 步"))
    expect(screen.getByText("Get-Date")).toBeTruthy()
    expect(screen.getByText("exit 1")).toBeTruthy()
    expect(screen.queryByText("2026-09-30")).toBeNull()
    fireEvent.click(screen.getByText("Get-Date"))
    expect(screen.getByText("2026-09-30")).toBeTruthy()
  })

  it("连着几步合成一条，中间夹着正文就分成两组", () => {
    show([
      agent({ kind: "command", itemId: "item_0", command: "ls", output: "", exitCode: 0, running: false }),
      agent({ kind: "command", itemId: "item_1", command: "pwd", output: "", exitCode: 0, running: false }),
      agent({ kind: "message", itemId: "item_2", text: "先看这两个" }),
      agent({ kind: "command", itemId: "item_3", command: "git status", output: "", exitCode: 0, running: false })
    ])
    expect(screen.getByText("调用过程 2 步")).toBeTruthy()
    expect(screen.getByText("调用过程 1 步")).toBeTruthy()
    expect(screen.getByText("先看这两个")).toBeTruthy()
  })

  it("跑着的命令只出转圈，不给退出码", () => {
    show([agent({ kind: "command", itemId: "item_0", command: "npm test", output: "", exitCode: null, running: true })])
    expect(screen.getByText("npm test")).toBeTruthy()
    expect(screen.queryByText(/没退出码/)).toBeNull()
  })

  it("文件改动一行说出改了哪几个，点开列路径与动作", () => {
    show([
      agent({
        kind: "fileChange",
        itemId: "item_1",
        running: false,
        changes: [
          { path: "src/a.ts", action: "update" },
          { path: "src/b.ts", action: "add" }
        ]
      })
    ])
    expect(screen.getByText("调用过程 1 步")).toBeTruthy()
    expect(screen.queryByText("src/a.ts")).toBeNull()
    fireEvent.click(screen.getByText("调用过程 1 步"))
    expect(screen.getByText("改了 2 个文件")).toBeTruthy()
    expect(screen.queryByText("src/a.ts")).toBeNull()
    fireEvent.click(screen.getByText("改了 2 个文件"))
    expect(screen.getByText("src/a.ts")).toBeTruthy()
    expect(screen.getByText("src/b.ts")).toBeTruthy()
    expect(screen.getByText("新增")).toBeTruthy()
  })

  it("MCP 工具与联网搜索各自一行", () => {
    show([
      agent({ kind: "tool", itemId: "item_2", server: "mastergo", tool: "getDsl", args: "{\"id\":1}", output: "ok", running: false }),
      agent({ kind: "search", itemId: "item_3", query: "codex exec json", running: false })
    ])
    expect(screen.getByText("调用过程 2 步")).toBeTruthy()
    fireEvent.click(screen.getByText("调用过程 2 步"))
    expect(screen.getByText("mastergo · getDsl")).toBeTruthy()
    expect(screen.getByText("搜索 codex exec json")).toBeTruthy()
  })

  it("思考过程收成一行", () => {
    show([agent({ kind: "reasoning", itemId: "item_4", text: "先看日志再决定", running: false })])
    fireEvent.click(screen.getByText("调用过程 1 步"))
    expect(screen.getByText("思考过程")).toBeTruthy()
    expect(screen.queryByText("先看日志再决定")).toBeNull()
  })

  it("一轮收尾带上 token 数", () => {
    show([agent({ kind: "turn", itemId: "turn", tokens: 1234 })])
    expect(screen.getByText("一轮结束（用了 1234 tokens）")).toBeTruthy()
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
      agent({ kind: "message", itemId: "item_0", text: "第一答" }),
      { kind: "log", text: "第一轮噪音\n", open: false },
      { kind: "you", text: "第二问" },
      agent({ kind: "message", itemId: "item_0", text: "第二答" }),
      { kind: "log", text: "第二轮噪音\n", open: false }
    ])
    expect(screen.getAllByText("引擎日志（1 行）")).toHaveLength(2)
  })
})
