import { beforeEach, describe, expect, it } from "vitest"

import { readOnlyEffective, writeOnlyEffective } from "@/lib/only-effective"

const KEY = "mastergo-transcoder-gui.onlyEffective"
const LEGACY_KEY = "mastergo-transcoder-gui.board"

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

  it("旧版本把这个开关写在创建任务的表单里：接过来，不重置", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ projectRoot: "somewhere", links: "", onlyEffective: false }))
    expect(readOnlyEffective()).toBe(false)
    // 新键一写就以后者为准。
    writeOnlyEffective(true)
    expect(readOnlyEffective()).toBe(true)
  })

  it("新键还没写过、旧记录里也没有这个字段：回到默认", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ projectRoot: "somewhere" }))
    expect(readOnlyEffective()).toBe(true)
  })

  it("存的是坏 JSON 时回到默认，不抛", () => {
    localStorage.setItem(KEY, "{ 坏掉")
    expect(readOnlyEffective()).toBe(true)
  })
})
