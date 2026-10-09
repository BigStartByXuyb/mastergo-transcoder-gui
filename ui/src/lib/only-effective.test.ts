import { beforeEach, describe, expect, it } from "vitest"

import { readOnlyEffective, writeOnlyEffective } from "@/lib/only-effective"

const KEY = "mastergo-transcoder-gui.onlyEffective"

beforeEach(() => {
  localStorage.clear()
})

describe("只看生效开关的记忆", () => {
  it("没存过就是开（默认只看生效）", () => {
    expect(readOnlyEffective()).toBe(true)
  })

  it("关掉之后读回来是关，再打开也是开", () => {
    writeOnlyEffective(false)
    expect(readOnlyEffective()).toBe(false)
    writeOnlyEffective(true)
    expect(readOnlyEffective()).toBe(true)
  })

  it("别的键里写着同名字段：不算数（只有这一个键认）", () => {
    localStorage.setItem("mastergo-transcoder-gui.board", JSON.stringify({ onlyEffective: false }))
    expect(readOnlyEffective()).toBe(true)
  })

  it("存的是坏 JSON 时回到默认，不抛", () => {
    localStorage.setItem(KEY, "{ 坏掉")
    expect(readOnlyEffective()).toBe(true)
  })
})
