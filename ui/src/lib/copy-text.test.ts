import { toast } from "sonner"
import { afterEach, describe, expect, it, vi } from "vitest"

import { copyText } from "@/lib/copy-text"
import { drive } from "@/lib/settings-fixtures"

// 复制文本：能走 Clipboard API 就走；它不可用或抛错时退回 textarea + execCommand，
// 成了提示一句、两条路都不成也照实说 —— 不能「说已复制、剪贴板里却没有」。

// 夹具路径按段拼：源码里不出现「盘符 + 反斜杠」那种机器专属写法（结构检查会拦）。
const PATH = drive("D", "a b", "c")

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("copyText", () => {
  it("走 Clipboard API，复制完提示一句", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const success = vi.spyOn(toast, "success")

    await copyText(PATH, "路径")

    expect(writeText).toHaveBeenCalledWith(PATH)
    expect(success).toHaveBeenCalledWith("已复制：路径")
  })

  it("Clipboard API 抛错时退回 execCommand，照样提示", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("不给用")) } })
    const exec = vi.fn().mockReturnValue(true)
    document.execCommand = exec
    const success = vi.spyOn(toast, "success")

    await copyText("P", "")

    expect(exec).toHaveBeenCalledWith("copy")
    expect(success).toHaveBeenCalledWith("已复制")
  })

  it("两条路都不成时不说「已复制」", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("不给用")) } })
    // execCommand 返回 false（浏览器说没做成）—— 也不能当成复制成功。
    document.execCommand = vi.fn().mockReturnValue(false)
    const success = vi.spyOn(toast, "success")
    const failed = vi.spyOn(toast, "error")

    await copyText("P", "路径")

    expect(success).not.toHaveBeenCalled()
    expect(failed).toHaveBeenCalledWith("没能复制到剪贴板，手动选一下这段文字")
  })

  it("空值什么都不做", async () => {
    const writeText = vi.fn()
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const success = vi.spyOn(toast, "success")

    await copyText("", "路径")

    expect(writeText).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
  })
})
