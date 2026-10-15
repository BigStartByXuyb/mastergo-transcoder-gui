import { describe, expect, it, vi } from "vitest"

import { ApiFailure } from "@/lib/api"
import { applyDownload, startDownload } from "@/lib/download-run"

/*
 * 「发起一次下载」的结果归一：四条下载线共用这一处判据 ——
 * 已经在跑（BUSY_DOWNLOAD / BUSY_INSTALL）不是失败，别写成红字。
 */

describe("startDownload", () => {
  it("下起来了 / 本地已经有这一份", async () => {
    expect(await startDownload(async () => ({ started: true, note: "", status: "s" }))).toEqual({
      kind: "started",
      message: "",
      status: "s"
    })
    expect(await startDownload(async () => ({ started: false, note: "", status: "s" }))).toEqual({
      kind: "already",
      message: "本地已经有这一份",
      status: "s"
    })
  })

  it("后端说「已经在下载了 / 已经在装插件了」时归到 busy，不算失败", async () => {
    for (const code of ["BUSY_DOWNLOAD", "BUSY_INSTALL"]) {
      const got = await startDownload(async () => {
        throw new ApiFailure(code, "已经在下载了", "等这一次下载结束。")
      })
      expect(got.kind).toBe("busy")
      expect(got.message).toContain("已经在下载了")
    }
  })

  it("别的错才算失败", async () => {
    const got = await startDownload(async () => {
      throw new ApiFailure("NO_REMOTE_VERSION", "远端没有 v0.0.1 这一版", "")
    })
    expect(got.kind).toBe("failed")
  })
})

describe("applyDownload", () => {
  it("busy 走 onBusy（没说就按「已经有这一份」那一路说一句），不碰 setFailure", () => {
    const setFailure = vi.fn()
    const onAlready = vi.fn()
    const onBusy = vi.fn()
    applyDownload({ kind: "busy", message: "已经在下载了", status: null }, { setFailure, onAlready, onBusy })
    expect(setFailure).not.toHaveBeenCalled()
    expect(onBusy).toHaveBeenCalledWith("已经在下载了")
    expect(onAlready).not.toHaveBeenCalled()
  })

  it("真正失败还是写红字", () => {
    const setFailure = vi.fn()
    applyDownload({ kind: "failed", message: "下载失败", status: null }, { setFailure, onAlready: vi.fn() })
    expect(setFailure).toHaveBeenCalledWith("下载失败")
  })
})
