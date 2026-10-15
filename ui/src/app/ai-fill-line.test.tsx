import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AiFillLine } from "@/app/ai-fill-line"

describe("AiFillLine", () => {
  it("列出补进去的每一项，并带上说明", () => {
    render(<AiFillLine filled={["MenuOk", "MenuCancel"]} note="（当时停在第 7 步）" />)
    expect(screen.getByText("MenuOk、MenuCancel")).toBeTruthy()
    expect(screen.getByText("（当时停在第 7 步）")).toBeTruthy()
  })
})
