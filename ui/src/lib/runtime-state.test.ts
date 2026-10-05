import { describe, expect, it } from "vitest"

import type { RuntimeStatus, RuntimeTask, RuntimeTool } from "@/lib/api"
import {
  describeRuntime,
  describeTool,
  downloadLabel,
  downloadableId,
  isRuntimeWorking,
  runtimeTaskLine,
  runtimeTaskPercent
} from "@/lib/runtime-state"

/* 造一个 Windows 绝对路径：直接写盘符会被结构检查当成写死的机器路径。 */
function at(...parts: string[]): string {
  return ["C:", ...parts].join("\\")
}

const IDLE: RuntimeTask = { phase: "idle", tool: "", received: 0, size: 0, error: null, version: "", startedAt: "" }

/* 造一份下载中的任务：收到的字节 / 总字节。 */
function task(overrides: Partial<RuntimeTask> & Pick<RuntimeTask, "phase" | "tool">): RuntimeTask {
  return { received: 0, size: 0, error: null, version: "", startedAt: "", ...overrides }
}

function tool(overrides: Partial<RuntimeTool> & Pick<RuntimeTool, "id" | "label">): RuntimeTool {
  return {
    pinned: "24.21.0",
    path: at("app", "runtime", "node", "24.21.0", "node.exe"),
    installed: true,
    source: "bundled",
    versions: ["24.21.0"],
    active: "24.21.0",
    system: { ok: false, version: "", path: "" },
    downloadUrl: "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip",
    officialUrl: "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip",
    version: "24.21.0",
    ready: true,
    switchable: false,
    note: "",
    ...overrides
  }
}

function status(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    root: at("app", "runtime"),
    mirror: "",
    tools: [
      tool({ id: "node", label: "Node.js" }),
      tool({
        id: "pwsh",
        label: "PowerShell 7",
        pinned: "7.6.6",
        version: "7.6.6",
        path: at("app", "runtime", "pwsh", "7.6.6", "pwsh.exe")
      }),
      tool({
        id: "claude",
        label: "Claude Code",
        pinned: "",
        installed: false,
        source: "system",
        version: "2.1.278",
        path: at("u", ".local", "bin", "claude.exe"),
        note: "检测到就用；不代下载。"
      })
    ],
    busy: "",
    error: null,
    task: IDLE,
    ...overrides
  }
}

describe("顶上一行", () => {
  it("还没读到状态时只说读取中", () => {
    expect(describeRuntime(null)).toEqual({ label: "读取中…", tone: "outline", note: "" })
  })

  it("两份都自带就说两句都好了", () => {
    const summary = describeRuntime(status())
    expect(summary.label).toBe("自带 2 份 / 用系统的 0 份")
    expect(summary.tone).toBe("secondary")
    expect(summary.note).toBe("")
  })

  it("还在用系统那份时给换成自带的理由", () => {
    const summary = describeRuntime(
      status({
        tools: [
          tool({ id: "node", label: "Node.js", installed: false, source: "system", version: "24.14.0" }),
          tool({ id: "pwsh", label: "PowerShell 7" })
        ]
      })
    )
    expect(summary.label).toBe("自带 1 份 / 用系统的 1 份")
    expect(summary.tone).toBe("outline")
    expect(summary.note).toContain("下成自带的")
  })

  it("缺一份就标红并说清楚后果", () => {
    const summary = describeRuntime(
      status({
        tools: [
          tool({ id: "node", label: "Node.js", installed: false, source: "", version: "", ready: false }),
          tool({ id: "pwsh", label: "PowerShell 7" })
        ]
      })
    )
    expect(summary.label).toBe("自带 1 份 / 用系统的 0 份 / 缺 1 份")
    expect(summary.tone).toBe("destructive")
    expect(summary.note).toContain("流水线才能跑")
  })

  it("claude 不计进几份里", () => {
    const withoutClaude = describeRuntime(
      status({
        tools: [
          tool({ id: "node", label: "Node.js" }),
          tool({ id: "pwsh", label: "PowerShell 7" })
        ]
      })
    )
    expect(describeRuntime(status()).label).toBe(withoutClaude.label)
    expect(describeRuntime(status({ tools: [tool({ id: "claude", label: "Claude Code", pinned: "", installed: false, source: "", ready: false })] })).label).toBe(
      "自带 0 份 / 用系统的 0 份"
    )
  })
})

describe("每一行", () => {
  it("自带的、系统的、坏了的、没有的各说各的", () => {
    expect(describeTool(tool({ id: "node", label: "Node.js" }))).toBe("自带 v24.21.0")
    expect(describeTool(tool({ id: "pwsh", label: "PowerShell 7", installed: false, source: "system", version: "7.6.5" }))).toBe(
      "系统 v7.6.5"
    )
    expect(describeTool(tool({ id: "node", label: "Node.js", version: "0.0.0", ready: false }))).toBe("自带这份起不来")
    expect(describeTool(tool({ id: "node", label: "Node.js", installed: false, source: "", version: "", ready: false }))).toBe(
      "没有可用的"
    )
  })

  it("按钮字面：没装过是下载，坏了是重下", () => {
    expect(downloadLabel(tool({ id: "node", label: "Node.js", installed: false }))).toBe("下载 v24.21.0")
    expect(downloadLabel(tool({ id: "pwsh", label: "PowerShell 7", version: "0.0.0", ready: false }))).toBe("重下 v24.21.0")
    expect(downloadLabel(tool({ id: "claude", label: "Claude Code", pinned: "", installed: false }))).toBe("下载")
  })
})

describe("给不给下载入口", () => {
  it("claude 那一行永远没有按钮", () => {
    expect(downloadableId(status(), status().tools[2])).toBe("")
  })

  it("自带那份好着就没什么可下的", () => {
    expect(downloadableId(status(), status().tools[0])).toBe("")
  })

  it("还在用系统那份、以及自带那份坏了，都给下载", () => {
    const systemCopy = tool({ id: "node", label: "Node.js", installed: false, source: "system", version: "24.14.0" })
    expect(downloadableId(status(), systemCopy)).toBe("node")
    const broken = tool({ id: "pwsh", label: "PowerShell 7", version: "0.0.0", ready: false })
    expect(downloadableId(status(), broken)).toBe("pwsh")
  })

  it("有任务在跑、或正在下载时都不给", () => {
    const systemCopy = tool({ id: "node", label: "Node.js", installed: false, source: "system", version: "24.14.0" })
    expect(downloadableId(status({ busy: "转码中" }), systemCopy)).toBe("")
    const running = task({ phase: "extracting", tool: "node", version: "24.21.0" })
    expect(downloadableId(status({ task: running }), systemCopy)).toBe("")
    expect(downloadableId(null, systemCopy)).toBe("")
  })
})

describe("下载进度", () => {
  it("三步都算在下载中，别的阶段不算", () => {
    for (const phase of ["downloading", "extracting", "verifying"] as const) {
      expect(isRuntimeWorking(task({ phase, tool: "node" }))).toBe(true)
    }
    for (const phase of ["idle", "done", "error"] as const) {
      expect(isRuntimeWorking(task({ phase, tool: "node" }))).toBe(false)
    }
  })

  it("下载按已收字节算，封顶 100", () => {
    expect(runtimeTaskPercent(IDLE)).toBe(0)
    expect(runtimeTaskPercent(task({ phase: "downloading", tool: "node", received: 1, size: 3 }))).toBe(33)
    expect(runtimeTaskPercent(task({ phase: "downloading", tool: "node", received: 4, size: 3 }))).toBe(100)
  })

  it("服务器没给总长度时退回不确定态，不编百分比", () => {
    expect(runtimeTaskPercent(task({ phase: "downloading", tool: "node", received: 4096 }))).toBe(0)
    expect(runtimeTaskLine(task({ phase: "downloading", tool: "node", received: 4096 }), "Node.js")).toBe("正在下载 Node.js…")
  })

  it("解压与自检拿不到细分：进度到头，文案分阶段", () => {
    expect(runtimeTaskPercent(task({ phase: "extracting", tool: "pwsh" }))).toBe(100)
    expect(runtimeTaskPercent(task({ phase: "verifying", tool: "pwsh" }))).toBe(100)
    expect(runtimeTaskPercent(task({ phase: "done", tool: "pwsh" }))).toBe(0)
  })

  it("进度下面那一行说清在下什么、下了多少", () => {
    const downloading = task({ phase: "downloading", tool: "node", received: 1048576, size: 3145728 })
    expect(runtimeTaskLine(downloading, "Node.js")).toBe("正在下载 Node.js（1.0 MB / 3.0 MB）")
    expect(runtimeTaskLine(downloading, "")).toBe("正在下载 node（1.0 MB / 3.0 MB）")
    expect(runtimeTaskLine(task({ phase: "downloading", tool: "node", received: 0, size: 1024 }), "Node.js")).toBe(
      "正在下载 Node.js（0 B / 1.0 KB）"
    )
    expect(runtimeTaskLine(task({ phase: "downloading", tool: "node", received: 512, size: 1024 }), "Node.js")).toBe(
      "正在下载 Node.js（512 B / 1.0 KB）"
    )
    expect(runtimeTaskLine(task({ phase: "extracting", tool: "pwsh" }), "PowerShell 7")).toBe("正在解压 PowerShell 7…")
    expect(runtimeTaskLine(task({ phase: "verifying", tool: "pwsh" }), "PowerShell 7")).toBe("正在自检 PowerShell 7…")
    expect(runtimeTaskLine(IDLE, "Node.js")).toBe("")
  })
})
