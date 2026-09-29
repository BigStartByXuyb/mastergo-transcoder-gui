import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { IdentifierText } from "@/app/identifier-text"

describe("IdentifierText", () => {
  it("按容器宽折行 + title 全文，不截断", () => {
    const path = "/proj/Generated/_work/steps/11-gates.log"
    render(<IdentifierText text={path} />)
    const node = screen.getByTitle(path)
    expect(node.textContent).toBe(path)
    expect(node.className).toContain("break-all")
    expect(node.className).toContain("font-mono")
    expect((node as HTMLElement).style.webkitLineClamp).toBe("")
  })

  it("空文本不渲染", () => {
    const { container } = render(<IdentifierText text="" />)
    expect(container.textContent).toBe("")
  })
})
