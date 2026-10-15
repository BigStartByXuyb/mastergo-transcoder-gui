import { afterEach, describe, expect, it } from "vitest"

import { readStored, writeStored } from "@/lib/storage"

afterEach(() => {
  localStorage.clear()
})

describe("readStored", () => {
  it("没存过时按 pick 逐字段取默认值（pick 负责字段级回落）", () => {
    expect(readStored("k", { a: "x" }, (raw) => ({ a: String(raw.a ?? "") }))).toEqual({ a: "" })
  })

  it("存过时按 pick 取值", () => {
    localStorage.setItem("k", JSON.stringify({ a: "y", b: 2 }))
    expect(readStored("k", { a: "x" }, (raw) => ({ a: String(raw.a ?? "") }))).toEqual({ a: "y" })
  })

  it("坏 JSON 与数组都不抛异常，直接回落", () => {
    localStorage.setItem("k", "not json")
    expect(readStored("k", { a: "x" }, (raw) => ({ a: String(raw.a ?? "") }))).toEqual({ a: "x" })
    localStorage.setItem("k", "[1,2]")
    expect(readStored("k", { a: "x" }, (raw) => ({ a: String(raw.a ?? "") }))).toEqual({ a: "x" })
  })
})

describe("writeStored", () => {
  it("写进去再读出来是同一份", () => {
    writeStored("k", { a: "z" })
    expect(JSON.parse(localStorage.getItem("k") ?? "{}")).toEqual({ a: "z" })
  })

  it("存储抛异常时不向外抛", () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError")
    }
    try {
      expect(() => writeStored("k", { a: 1 })).not.toThrow()
    } finally {
      Storage.prototype.setItem = original
    }
  })
})

