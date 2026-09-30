import type { UpdateStatus, UpdateTask } from "@/lib/api"

export type UpdateTone = "secondary" | "outline" | "destructive"

/** 版本列表里的一行：版本号 + 这一版改了什么 + 本地状态。 */
export type VersionRow = {
  version: string
  date: string
  notes: string[]
  current: boolean
  /** 本地这一份下载齐了，能切过去。 */
  ready: boolean
  /** 本地有没有这一份。 */
  installed: boolean
  /** 远端清单里的那一版（可能就是有新版）。 */
  remote: boolean
}

// 版本号只按数字段比大小，段数不齐时短的补 0；两边都这么比，顺序才不会一处一个样。
function compareVersions(a: string, b: string): number {
  const left = a.split(".")
  const right = b.split(".")
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const x = Number(left[index] ?? 0)
    const y = Number(right[index] ?? 0)
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** candidate 比 current 新。远端清单可能是上一次检查留下的旧数据，比较只认这一处。 */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}

/*
 * 一张版本表，三个来源合成：本地版本历史（changelog）、已下载的那几份、远端清单里的那一版。
 * 同一个版本号只出一行 —— 界面按这一张表渲染，不会出现「两处各列一遍」。
 */
export function versionList(status: UpdateStatus): VersionRow[] {
  const rows = new Map<string, VersionRow>()
  const put = (row: VersionRow) => rows.set(row.version, row)

  for (const entry of status.history) {
    put({
      version: entry.version,
      date: entry.date,
      notes: entry.notes,
      current: entry.version === status.current,
      ready: false,
      installed: false,
      remote: false
    })
  }
  for (const item of status.staged) {
    const row = rows.get(item.version)
    if (row) {
      row.installed = true
      row.ready = item.ready
      row.current = item.current
      continue
    }
    put({
      version: item.version,
      date: "",
      notes: [],
      current: item.current,
      ready: item.ready,
      installed: true,
      remote: false
    })
  }
  if (status.available) {
    // 清单可能是上一次检查留下的：不比当前新就不是「有新版」，只当一条历史列出来。
    const newer = isNewer(status.available.version, status.current)
    const row = rows.get(status.available.version)
    // 远端清单里带着这一版改了什么：本地历史还没有它的时候用远端那份。
    if (row) {
      if (row.notes.length === 0) row.notes = status.available.notes
      row.remote = newer
    }
    else {
      put({
        version: status.available.version,
        date: status.available.releasedAt.slice(0, 10),
        notes: status.available.notes,
        current: false,
        ready: false,
        installed: false,
        remote: newer
      })
    }
  }
  return [...rows.values()].sort((a, b) => compareVersions(b.version, a.version))
}

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
  // 上一次检查留下的清单可能已经过期（现在跑的这版比它还新）：那就不摆差分量。
  if (!isNewer(available.version, status.current)) return ""
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
