import { describe, expect, it } from "vitest"

import type { UpdateStatus, UpdateTask } from "@/lib/api"
import {
  canSwitch,
  describeAvailable,
  describeTask,
  describeUpdate,
  isDownloading,
  taskPercent,
  versionList
} from "@/lib/update-state"

const task = (patch: Partial<UpdateTask> = {}): UpdateTask => ({
  phase: "idle",
  done: 0,
  total: 0,
  downloaded: 0,
  error: null,
  ...patch
})

const status = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  state: "up_to_date",
  current: "0.1.0",
  currentNotes: [],
  history: [],
  root: "",
  pointer: null,
  busy: "",
  staged: [{ version: "0.1.0", current: true, ready: true }],
  ready: "",
  rollback: "",
  available: null,
  error: null,
  task: task(),
  repo: "BigStartByXuyb/mastergo-transcoder-gui",
  ...patch
})

const available = (patch: Partial<NonNullable<UpdateStatus["available"]>> = {}) => ({
  version: "0.2.0",
  notes: [],
  releasedAt: "2026-09-30T00:00:00.000Z",
  minClientVersion: "",
  freshRunRequired: true,
  changed: 4,
  removed: 1,
  total: 43,
  blocked: null,
  checkedAt: "2026-09-30T00:00:00.000Z",
  ...patch
})

describe("describeUpdate", () => {
  it("没拿到状态时先说读取中", () => {
    expect(describeUpdate(null)).toEqual({ label: "读取中…", tone: "outline", note: "" })
  })

  it("四态各给人话，并说清下一步", () => {
    expect(describeUpdate(status()).label).toBe("已是最新 v0.1.0")
    expect(describeUpdate(status({ state: "update_available", available: available() })).label).toBe("有新版本 v0.2.0")

    const ready = describeUpdate(status({ state: "download_ready", ready: "0.2.0" }))
    expect(ready.label).toBe("v0.2.0 已下载")
    expect(ready.note).toContain("start.cmd")

    const failed = describeUpdate(
      status({ state: "error", error: { code: "DOWNLOAD_FAILED", message: "下载失败", hint: "断网了" } })
    )
    expect(failed.tone).toBe("destructive")
    expect(failed.note).toBe("下载失败")
  })

  it("没有原因的错误不编一句话出来", () => {
    expect(describeUpdate(status({ state: "error" })).note).toBe("")
  })
})

describe("describeAvailable", () => {
  it("说清要换几个、删几个、要不要新开运行", () => {
    expect(describeAvailable(status({ available: available() }))).toBe(
      "运行树 43 个文件，要比对替换 4 个、删掉 1 个；这版要求新开一次运行。"
    )
  })

  it("外壳有下限时先报下限，其余不提", () => {
    const text = describeAvailable(
      status({
        available: available({
          blocked: { code: "CLIENT_TOO_OLD", message: "v0.2.0 要求客户端至少 v0.3.0", hint: "先装新版安装包。" }
        })
      })
    )
    expect(text).toBe("v0.2.0 要求客户端至少 v0.3.0。先装新版安装包。")
  })

  it("没有远端清单就什么都不说", () => {
    expect(describeAvailable(status())).toBe("")
  })

  // 清单是上一次检查留下的旧数据时，别把「要不要换 11 个文件」摆出来吓人。
  it("远端那一版不比现在新就不说差分", () => {
    expect(describeAvailable(status({ current: "0.3.0", available: available({ version: "0.2.1" }) }))).toBe("")
  })
})

describe("describeTask", () => {
  it("每种阶段一句话", () => {
    expect(describeTask(task())).toBe("")
    expect(describeTask(task({ phase: "downloading", done: 2, total: 5, downloaded: 2 }))).toBe(
      "正在下载 2/5（其中新内容 2 个）"
    )
    expect(describeTask(task({ phase: "materializing", done: 5, total: 5 }))).toBe("正在拼装这一版…")
    expect(describeTask(task({ phase: "done" }))).toBe("下载完成")
    expect(
      describeTask(task({ phase: "error", error: { code: "HTTP_404", message: "下载失败（HTTP 404）", hint: "" } }))
    ).toBe("下载失败（HTTP 404）")
    expect(describeTask(task({ phase: "error" }))).toBe("下载失败")
  })

  it("进度百分比封顶 100，且不给总量时是 0", () => {
    expect(taskPercent(task({ phase: "downloading", done: 1, total: 4 }))).toBe(25)
    expect(taskPercent(task({ phase: "downloading", done: 9, total: 4 }))).toBe(100)
    expect(taskPercent(task())).toBe(0)
  })

  it("正在下载才轮询", () => {
    expect(isDownloading(task({ phase: "downloading" }))).toBe(true)
    expect(isDownloading(task({ phase: "materializing" }))).toBe(true)
    expect(isDownloading(task({ phase: "done" }))).toBe(false)
  })
})

describe("canSwitch", () => {
  const ready = { version: "0.2.0", current: false, ready: true }

  it("下载好了、空闲、不是当前这一版才让切", () => {
    expect(canSwitch(status({ state: "download_ready", ready: "0.2.0", staged: [ready] }))).toBe(true)
    expect(canSwitch(status({ state: "download_ready", ready: "0.2.0", staged: [ready] }), "0.2.0")).toBe(true)
  })

  it("有任务在跑就不让切", () => {
    expect(canSwitch(status({ state: "download_ready", ready: "0.2.0", staged: [ready], busy: "1 次流水线正在跑" }))).toBe(
      false
    )
  })

  it("没下载好、或目标就是当前这一版，都不让切", () => {
    expect(canSwitch(null)).toBe(false)
    expect(canSwitch(status())).toBe(false)
    expect(canSwitch(status({ state: "download_ready", ready: "0.1.0", staged: [] }))).toBe(false)
    expect(
      canSwitch(status({ state: "download_ready", ready: "0.3.0", staged: [{ version: "0.3.0", current: false, ready: false }] }))
    ).toBe(false)
  })
})

describe("versionList", () => {
  it("版本历史、装好的那几份、远端那一版合成一张表，同一个版本号只出一行", () => {
    const rows = versionList(
      status({
        current: "0.2.1",
        currentNotes: ["代理兜底"],
        history: [
          { version: "0.2.1", date: "2026-09-30", notes: ["代理兜底"] },
          { version: "0.2.0", date: "2026-09-30", notes: ["第一个可分发版本"] }
        ],
        staged: [
          { version: "0.2.1", current: true, ready: true },
          { version: "0.2.0", current: false, ready: true }
        ],
        available: available({ version: "0.3.0", notes: ["对话页重做"] })
      })
    )
    expect(rows.map((row) => row.version)).toEqual(["0.3.0", "0.2.1", "0.2.0"])
    expect(rows[0]).toMatchObject({ installed: false, remote: true, notes: ["对话页重做"] })
    expect(rows[1]).toMatchObject({ current: true, installed: true, notes: ["代理兜底"] })
    expect(rows[2]).toMatchObject({ current: false, installed: true, ready: true })
  })

  it("清单里那一版不比现在新，就不算「有新版」", () => {
    const rows = versionList(
      status({
        current: "0.3.0",
        history: [
          { version: "0.3.0", date: "2026-09-30", notes: ["本版"] },
          { version: "0.2.1", date: "2026-09-30", notes: ["代理兜底"] }
        ],
        staged: [{ version: "0.3.0", current: true, ready: true }],
        available: available({ version: "0.2.1", notes: ["代理兜底"] })
      })
    )
    expect(rows.map((row) => row.version)).toEqual(["0.3.0", "0.2.1"])
    expect(rows[1].remote).toBe(false)
    expect(rows[1].notes).toEqual(["代理兜底"])
  })

  it("本地历史里没有的版本照样列出来，说明留空不编", () => {
    const rows = versionList(
      status({
        current: "0.3.0",
        history: [{ version: "0.3.0", date: "2026-09-30", notes: ["设置页拆子页"] }],
        staged: [
          { version: "0.3.0", current: true, ready: true },
          { version: "0.9.9", current: false, ready: false }
        ],
        available: null
      })
    )
    expect(rows.map((row) => row.version)).toEqual(["0.9.9", "0.3.0"])
    expect(rows[0].notes).toEqual([])
    expect(rows[0].installed).toBe(true)
    expect(rows[1].notes).toEqual(["设置页拆子页"])
  })
})
