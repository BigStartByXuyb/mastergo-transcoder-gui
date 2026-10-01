import { beforeEach, describe, expect, it } from "vitest"

import { migrateOnlyEffective, readOnlyEffective, writeOnlyEffective } from "@/lib/only-effective"

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

  it("旧版本把这个开关写在创建任务的表单里：搬过来，之后表单覆写旧键也不丢", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ projectRoot: "somewhere", links: "", onlyEffective: false }))
    expect(readOnlyEffective()).toBe(false)
    // 看板页就是这么做的：写表单之前先搬一次。
    migrateOnlyEffective()
    // 看板一挂载就把旧键整条覆写成表单对象（这句就是 board-form 的实际写法）——旧字段没了。
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ projectRoot: "somewhere", ui: "", mode: "B" }))
    // 搬过的值还在：只读不落盘的话，这里会掉回默认 true。
    expect(readOnlyEffective()).toBe(false)
  })

  it("搬过一次就不再看旧键：新键为准", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ onlyEffective: false }))
    migrateOnlyEffective()
    writeOnlyEffective(true)
    expect(readOnlyEffective()).toBe(true)
  })

  it("新键已经写过：不拿旧键的值覆盖它", () => {
    writeOnlyEffective(true)
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ onlyEffective: false }))
    migrateOnlyEffective()
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
