import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { readOnlyEffective } from "@/lib/only-effective"
import { useOnlyEffective } from "@/lib/use-only-effective"

const KEY = "mastergo-transcoder-gui.onlyEffective"

beforeEach(() => {
  localStorage.clear()
})

describe("useOnlyEffective", () => {
  it("初次渲染读的是记着的那一份", () => {
    localStorage.setItem(KEY, JSON.stringify({ value: false }))
    const { result } = renderHook(() => useOnlyEffective())
    expect(result.current.onlyEffective).toBe(false)
  })

  it("改一次就落盘：换个组件再读也是新值", () => {
    const first = renderHook(() => useOnlyEffective())
    expect(first.result.current.onlyEffective).toBe(true)

    act(() => first.result.current.setOnlyEffective(false))
    expect(first.result.current.onlyEffective).toBe(false)
    expect(readOnlyEffective()).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toEqual({ value: false })

    const second = renderHook(() => useOnlyEffective())
    expect(second.result.current.onlyEffective).toBe(false)
  })
})
