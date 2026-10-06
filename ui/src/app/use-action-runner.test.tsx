import { act, renderHook } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useActionRunner } from "@/app/use-action-runner"

/*
 * 动作骨架：置 working → 清旧错 → 跑 → 套用状态 → 提示 → 收尾。
 * 四张卡片（程序更新、Codex、运行时、插件安装）共用这一处，所以这里盯住每一步都真的发生了。
 */

afterEach(() => {
  vi.restoreAllMocks()
})

function harness<T>() {
  const setWorking = vi.fn()
  const setFailure = vi.fn()
  const setStatus = vi.fn()
  const { result } = renderHook(() => useActionRunner<T>({ setWorking, setFailure, setStatus }))
  return { run: result.current, setWorking, setFailure, setStatus }
}

describe("useActionRunner", () => {
  it("按指定 key 置 working、清旧错、套用状态、给一句话提示，最后复位", async () => {
    const success = vi.spyOn(toast, "success")
    const { run, setWorking, setFailure, setStatus } = harness<string>()

    await act(async () => {
      await run("check", async () => ({ status: "ok" }), "检查完成")
    })

    expect(setWorking.mock.calls).toEqual([["check"], [""]])
    expect(setFailure).toHaveBeenCalledWith("")
    expect(setStatus).toHaveBeenCalledWith("ok")
    expect(success).toHaveBeenCalledWith("检查完成")
  })

  it("done 给函数时把整个载荷交给它（按结果决定说什么）", async () => {
    const { run } = harness<string>()
    const seen: string[] = []

    await act(async () => {
      await run("download", async () => ({ status: "ok", kind: "started" }), (payload) => seen.push(payload.kind))
    })

    expect(seen).toEqual(["started"])
  })

  it("状态是 null 时不套用（有些接口会把上一次的结果留在里面）", async () => {
    const { run, setStatus } = harness<string>()

    await act(async () => {
      await run("check", async () => ({ status: null }))
    })

    expect(setStatus).not.toHaveBeenCalled()
  })

  it("失败翻成一句话落到 setFailure，working 照样复位", async () => {
    const { run, setWorking, setFailure } = harness<string>()

    await act(async () => {
      await run("check", async () => {
        throw new Error("连不上")
      })
    })

    expect(setFailure).toHaveBeenLastCalledWith("连不上")
    expect(setWorking.mock.calls).toEqual([["check"], [""]])
  })
})
