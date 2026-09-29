/* Codex 这条版本线的文案与可点性判定：界面只显示结论，规则都在这里。 */

import type { CodexState, CodexStatus, CodexVersion } from "@/lib/api"

export type CodexTone = "secondary" | "outline" | "destructive"

export type CodexSummary = { label: string; tone: CodexTone; note: string }

const STATE_LABEL: Record<CodexState, string> = {
  verified: "自检通过",
  untested: "没验证过",
  broken: "起不来"
}

export function stateLabel(state: CodexState): string {
  return STATE_LABEL[state] ?? "没验证过"
}

export function sourceLabel(source: string): string {
  return source === "system" ? "本机装的" : "客户端下载的"
}

/* 现在跑的是哪一份、这一份可不可靠。 */
export function describeEngine(status: CodexStatus | null): CodexSummary {
  if (!status) return { label: "读取中…", tone: "outline", note: "" }
  if (!status.engine) {
    return { label: "还没有可用的 Codex", tone: "destructive", note: "在下面下载一份，或装一个 Codex 客户端。" }
  }
  const engine = status.engine
  const label = sourceLabel(engine.source) + " v" + engine.version
  if (engine.state === "broken") {
    return { label: label, tone: "destructive", note: "这一份起不来，换一份或重新下载。" }
  }
  return { label: label, tone: engine.state === "verified" ? "secondary" : "outline", note: stateLabel(engine.state) }
}

/* 远端那一版与本地的关系；只在检查过之后才有话说。 */
export function describeRelease(status: CodexStatus | null): string {
  if (!status) return ""
  if (status.error) return status.error.message + (status.error.hint ? "。" + status.error.hint : "")
  const release = status.release
  if (!release) return "还没检查过远端版本。"
  if (release.missing.length) {
    return "v" + release.version + " 少了 " + release.missing.length + " 个程序：" + release.missing.join("、")
  }
  if (release.newer) return "远端有 v" + release.version + "，比现在用的新。"
  return "已是最新 v" + release.version + "。"
}

/* 这一版能不能切过去：本地有、不是当前这份、没任务在跑。 */
export function canSwitchTo(status: CodexStatus | null, version: string): boolean {
  if (!status || status.busy) return false
  if (!version) return Boolean(status.system.length) && !(status.engine && status.engine.source === "system")
  const item = status.versions.find((entry) => entry.version === version)
  if (!item || !item.ready || item.active) return false
  return true
}

export function describeVersion(item: CodexVersion): string {
  return "v" + item.version + "（" + stateLabel(item.state) + "）"
}

/* 能不能下：检查过、清单不缺程序、这一版还没落地，且此刻没有下载在跑。 */
export function canDownload(status: CodexStatus | null): boolean {
  if (!status || !status.release || status.release.missing.length) return false
  if (status.task.phase === "downloading" || status.task.phase === "materializing") return false
  const version = status.release.version
  return !status.versions.some((item) => item.version === version && item.ready)
}

/* 回退只在刚切过版本之后可用：指针里记着上一份才给按钮。 */
export function canRollback(status: CodexStatus | null): boolean {
  if (!status || status.busy) return false
  return Boolean(status.pointer && status.pointer.previous)
}
