/*
 * 运行时那三行的文案与可点性：界面只画结论，规则都在这里。
 * node / pwsh 各钉死一版放进安装根，坏了只能重下修好；claude 只检测，不代下载。
 */

import type { RuntimeId, RuntimeStatus, RuntimeTask, RuntimeTool } from "@/lib/api"

export type RuntimeTone = "secondary" | "outline" | "destructive"

export type RuntimeSummary = { label: string; tone: RuntimeTone; note: string }

/*
 * 顶上一行：自带几份、还在用系统几份、缺几份。
 * 缺一份就标红 —— 这两份都在关键路径上，缺哪个流水线都起不来。
 */
export function describeRuntime(status: RuntimeStatus | null): RuntimeSummary {
  if (!status) return { label: "读取中…", tone: "outline", note: "" }
  const pinned = status.tools.filter((item) => item.id !== "claude")
  const bundled = pinned.filter((item) => item.source === "bundled" && item.ready).length
  const system = pinned.filter((item) => item.source === "system" && item.ready).length
  const missing = pinned.length - bundled - system
  const label = "自带 " + bundled + " 份 / 用系统的 " + system + " 份" + (missing ? " / 缺 " + missing + " 份" : "")
  if (missing) return { label, tone: "destructive", note: "缺的那几份下下来，流水线才能跑。" }
  if (system) return { label, tone: "outline", note: "现在能跑；下成自带的就不用管本机装没装。" }
  return { label, tone: "secondary", note: "" }
}

/*
 * 这一份现在是什么：自带哪一版 / 用系统的哪一版 / 起不来 / 系统上有但没允许 / 没有。
 * 「系统上有但没允许」必须说出来 —— 不然人以为要重下 100 兆，其实打开开关就能先用上。
 */
export function describeTool(tool: RuntimeTool): string {
  if (tool.ready) return (tool.source === "bundled" ? "自带" : "系统") + " v" + tool.version
  if (tool.installed) return "自带这份起不来"
  if (tool.system.ok) return "系统上有 v" + tool.system.version + "，没允许用"
  return "没有可用的"
}

/* 按钮字面：没装过说「下载」，装过但坏了说「重下」。 */
export function downloadLabel(tool: RuntimeTool): string {
  return (tool.installed ? "重下" : "下载") + (tool.pinned ? " v" + tool.pinned : "")
}

/* 下载的三步：下载 → 解压 → 自检。 */
export function isRuntimeWorking(task: RuntimeTask): boolean {
  return task.phase === "downloading" || task.phase === "extracting" || task.phase === "verifying"
}

/* 字节数按单位写给人看；拿不到总数时是 0 B。 */
function formatBytes(value: number): string {
  const bytes = Number.isFinite(value) && value > 0 ? value : 0
  const units = ["B", "KB", "MB", "GB"]
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size = size / 1024
    unit = unit + 1
  }
  return (unit === 0 ? String(Math.round(size)) : size.toFixed(1)) + " " + units[unit]
}

/*
 * 进度条：下载按已收字节算；解压、自检拿不到细分，下载完了就到头。
 * 服务器没给总长度时恒为 0 —— 界面退回不确定态，不编一个假百分比。
 */
export function runtimeTaskPercent(task: RuntimeTask): number {
  if (task.phase === "downloading") {
    if (!(task.size > 0)) return 0
    return Math.min(100, Math.round((task.received / task.size) * 100))
  }
  if (task.phase === "extracting" || task.phase === "verifying") return 100
  return 0
}

/* 进度条下面那一行；不在下载中就没有这行。 */
export function runtimeTaskLine(task: RuntimeTask, label: string): string {
  const name = label || task.tool
  if (task.phase === "downloading") {
    if (!(task.size > 0)) return "正在下载 " + name + "…"
    return "正在下载 " + name + "（" + formatBytes(task.received) + " / " + formatBytes(task.size) + "）"
  }
  if (task.phase === "extracting") return "正在解压 " + name + "…"
  if (task.phase === "verifying") return "正在自检 " + name + "…"
  return ""
}

/*
 * 这一行给不给下载入口，给的话是哪个 —— 空串就是不显示按钮。
 * claude 不代下载；自带那份好着就没什么可下的；有任务在跑不给下（半路换掉正在用的那份会把那次跑废）。
 * 用着系统那份时按钮留着：下成自带的，就不用管本机装没装。
 */
export function downloadableId(status: RuntimeStatus | null, tool: RuntimeTool): RuntimeId | "" {
  if (!status || status.busy || isRuntimeWorking(status.task)) return ""
  if (tool.id === "claude") return ""
  if (tool.installed && tool.ready) return ""
  return tool.id
}
