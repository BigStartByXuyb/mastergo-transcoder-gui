import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useRemembered } from "@/app/use-remembered"

/*
 * 本地记住的值：起步读一次，之后每改一次写回一次。
 * 两张「新建任务」表单、看板筛选、只看生效都读这一条。
 */
describe("useRemembered", () => {
  it("起步读的是记着的那一份", () => {
    const { result } = renderHook(() => useRemembered(() => "记着的", () => undefined))
    expect(result.current[0]).toBe("记着的")
  })

  it("改一下就写回：换一个组件再读也是新值", () => {
    let stored = "旧"
    const useOne = () => useRemembered(() => stored, (value) => { stored = value })

    const first = renderHook(useOne)
    act(() => first.result.current[1]("新"))
    expect(first.result.current[0]).toBe("新")
    expect(stored).toBe("新")

    const second = renderHook(useOne)
    expect(second.result.current[0]).toBe("新")
  })

  it("用更新函数改也写回", () => {
    let stored = "a"
    const { result } = renderHook(() => useRemembered(() => stored, (value) => { stored = value }))

    act(() => result.current[1]((current) => current + "b"))
    expect(result.current[0]).toBe("ab")
    expect(stored).toBe("ab")
  })
})
