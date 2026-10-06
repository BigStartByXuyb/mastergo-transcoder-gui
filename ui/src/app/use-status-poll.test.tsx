import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { IDLE_POLL_MS, WORKING_POLL_MS, useStatusPoll } from "@/app/use-status-poll"

/*
 * 轮询：挂上先取一次、空闲慢、进行中快、手动 reload 立刻取一次、失败翻成一句话、卸下不再取。
 * 节拍用假定时器推进，不真等 15 秒。
 */

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("useStatusPoll", () => {
  it("挂上先取一次，之后按空闲节拍再取", async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValue({ value: 1 })
    const onData = vi.fn()
    renderHook(() => useStatusPoll({ load, onData, onError: vi.fn(), working: false }))

    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)
    expect(onData).toHaveBeenCalledWith({ value: 1 })

    await act(async () => {
      vi.advanceTimersByTime(IDLE_POLL_MS - 1)
    })
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("传输中换快节拍；workingMs 可以另给", async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValue({ value: 1 })
    const { rerender } = renderHook(
      (props: { working: boolean }) => useStatusPoll({ load, onData: vi.fn(), onError: vi.fn(), working: props.working }),
      { initialProps: { working: false } }
    )
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)

    rerender({ working: true })
    await act(async () => {})
    await act(async () => {
      vi.advanceTimersByTime(WORKING_POLL_MS)
    })
    expect(load).toHaveBeenCalledTimes(3)

    const quick = vi.fn().mockResolvedValue({ value: 2 })
    const { unmount } = renderHook(() =>
      useStatusPoll({ load: quick, onData: vi.fn(), onError: vi.fn(), working: true, workingMs: 1000 })
    )
    await act(async () => {})
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(quick).toHaveBeenCalledTimes(2)
    unmount()
  })

  it("reload 立刻取一次", async () => {
    const load = vi.fn().mockResolvedValue({ value: 3 })
    const onData = vi.fn()
    const { result } = renderHook(() => useStatusPoll({ load, onData, onError: vi.fn(), working: false }))
    await act(async () => {})
    await act(async () => {
      await result.current.reload()
    })
    expect(load).toHaveBeenCalledTimes(2)
    expect(onData).toHaveBeenLastCalledWith({ value: 3 })
  })

  it("失败翻成一句话交给 onError", async () => {
    const load = vi.fn().mockRejectedValue(new Error("连不上"))
    const onError = vi.fn()
    renderHook(() => useStatusPoll({ load, onData: vi.fn(), onError, working: false }))
    await act(async () => {})
    expect(onError).toHaveBeenCalledWith("连不上")
  })

  it("卸下之后不再取、也不再回写", async () => {
    vi.useFakeTimers()
    let resolveLoad: (value: unknown) => void = () => {}
    const load = vi.fn(() => new Promise((resolve) => { resolveLoad = resolve }))
    const onData = vi.fn()
    const { unmount } = renderHook(() => useStatusPoll({ load, onData, onError: vi.fn(), working: false }))

    unmount()
    await act(async () => {
      resolveLoad({ value: 9 })
    })
    expect(onData).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(IDLE_POLL_MS * 2)
    })
    expect(load).toHaveBeenCalledTimes(1)
  })
})
