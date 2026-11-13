import { afterEach, describe, expect, it } from "vitest"

import { readBoardForm } from "@/lib/board-form"

afterEach(() => {
  localStorage.clear()
})

describe("readBoardForm", () => {
  it("记住的路线与流水线表单共用同一份归一", () => {
    localStorage.setItem("mastergo-transcoder-gui.board", JSON.stringify({ mode: " b " }))
    expect(readBoardForm().mode).toBe("B")
    localStorage.setItem("mastergo-transcoder-gui.board", JSON.stringify({ mode: "C" }))
    expect(readBoardForm().mode).toBe("A")
  })
})
