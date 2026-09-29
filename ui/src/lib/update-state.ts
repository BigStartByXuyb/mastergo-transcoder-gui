import type { UpdateStatus, UpdateTask } from "@/lib/api"

export type UpdateTone = "secondary" | "outline" | "destructive"

export type UpdateSummary = { label: string; tone: UpdateTone; note: string }

/* 四态翻成人话。note 只说下一步或原因，不复述状态名。 */
export function describeUpdate(status: UpdateStatus | null): UpdateSummary {
  if (!status) return { label: "读取中…", tone: "outline", note: "" }
  if (status.state === "download_ready") {
    return {
      label: "v" + status.ready + " 已下载",
      tone: "secondary",
      note: "关掉这个窗口再重新双击 start.cmd，就切到 v" + status.ready + " 跑。"
    }
  }
  if (status.state === "error") {
    return { label: "更新检查失败", tone: "destructive", note: status.error ? status.error.message : "" }
  }
  if (status.state === "update_available") {
    return { label: "有新版本 v" + (status.available ? status.available.version : ""), tone: "secondary", note: "" }
  }
  return { label: "已是最新 v" + status.current, tone: "outline", note: "" }
}

/* 差分量与硬性要求：外壳有下限就先说下限，否则说清要换几个文件。 */
export function describeAvailable(status: UpdateStatus): string {
  const available = status.available
  if (!available) return ""
  if (available.blocked) {
    return available.blocked.message + "。" + available.blocked.hint
  }
  const parts = [
    "运行树 " + available.total + " 个文件，要比对替换 " + available.changed + " 个"
      + (available.removed ? "、删掉 " + available.removed + " 个" : "")
  ]
  if (available.freshRunRequired) parts.push("这版要求新开一次运行")
  return parts.join("；") + "。"
}

/* 下载进度：不在下载/拼装就不显示。 */
export function describeTask(task: UpdateTask): string {
  if (task.phase === "downloading") {
    return "正在下载 " + task.done + "/" + task.total + "（其中新内容 " + task.downloaded + " 个）"
  }
  if (task.phase === "materializing") return "正在拼装这一版…"
  if (task.phase === "error") return task.error ? task.error.message : "下载失败"
  if (task.phase === "done") return "下载完成"
  return ""
}

export function isDownloading(task: UpdateTask): boolean {
  return task.phase === "downloading" || task.phase === "materializing"
}

export function taskPercent(task: UpdateTask): number {
  if (task.total <= 0) return 0
  return Math.min(100, Math.round((task.done / task.total) * 100))
}

/* 能不能切：下载好了、没任务在跑、且不是当前这一版。 */
export function canSwitch(status: UpdateStatus | null, version = ""): boolean {
  if (!status || status.busy) return false
  const target = version || status.ready
  if (!target || target === status.current) return false
  const staged = status.staged.find((item) => item.version === target)
  return Boolean(staged && staged.ready)
}
