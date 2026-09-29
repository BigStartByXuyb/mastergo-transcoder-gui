import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ClampText } from "@/app/clamp-text"

describe("ClampText", () => {
  it("默认三行截断，全文放在 title 里可悬停查看", () => {
    const text = "很长的失败原因：插件第 11 步门禁不通过，日志在工作目录的 Generated/_work/steps/11-gates.log"
    render(<ClampText text={text} />)
    const node = screen.getByTitle(text)
    expect(node.textContent).toBe(text)
    expect((node as HTMLElement).style.webkitLineClamp).toBe("3")
    expect((node as HTMLElement).style.overflow).toBe("hidden")
  })

  it("空文本不渲染，行数可指定", () => {
    const { container } = render(<ClampText text="" />)
    expect(container.textContent).toBe("")
    render(<ClampText text="一段很长的说明" lines={2} />)
    expect((screen.getByTitle("一段很长的说明") as HTMLElement).style.webkitLineClamp).toBe("2")
  })
})
