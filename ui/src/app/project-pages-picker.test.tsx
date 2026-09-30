import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ProjectPagesPicker } from "@/app/project-pages-picker"
import type { ProjectPages } from "@/lib/api"

function pages(patch: Partial<ProjectPages> = {}): ProjectPages {
  return { exists: true, registryPath: "/project/docs/page-registry.json", pages: [], problem: "", ...patch }
}

describe("ProjectPagesPicker", () => {
  it("没读到登记表就什么都不画", () => {
    const { container } = render(<ProjectPagesPicker pages={null} target="" ui="" onPick={vi.fn()} />)
    expect(container.textContent).toBe("")
  })

  it("登记表不存在时说出原因", () => {
    render(
      <ProjectPagesPicker
        pages={pages({ exists: false, problem: "这个工程没有 docs/page-registry.json" })}
        target=""
        ui=""
        onPick={vi.fn()}
      />
    )
    expect(screen.getByText("这个工程没有 docs/page-registry.json")).toBeTruthy()
  })

  it("登记表是空的就说明没有条目", () => {
    render(<ProjectPagesPicker pages={pages()} target="" ui="" onPick={vi.fn()} />)
    expect(screen.getByText("登记表里还没有可用的页面条目。")).toBeTruthy()
  })

  it("按 UI 分组，点一下回填 Target 与 Ui", () => {
    const onPick = vi.fn()
    render(
      <ProjectPagesPicker
        pages={pages({
          pages: [
            { target: "F1StopAdjust", ui: "F1", derivation: "", fileId: "", layerId: "1:2", designPageName: "停止调整" },
            { target: "", ui: "F1", derivation: "", fileId: "", layerId: "3:4", designPageName: "" },
            { target: "HomeContent", ui: "", derivation: "", fileId: "", layerId: "5:6", designPageName: "" }
          ]
        })}
        target=""
        ui="F1"
        onPick={onPick}
      />
    )
    // 两个 F1 的条目在同一段，没写 Ui 的那条自成一段并显示 layerId。
    expect(screen.getByText("F1")).toBeTruthy()
    expect(screen.getByText("（未写 Ui）")).toBeTruthy()
    expect(screen.getByText("3:4")).toBeTruthy()

    fireEvent.click(screen.getByText("F1StopAdjust"))
    expect(onPick).toHaveBeenCalledWith({ target: "F1StopAdjust", ui: "F1" })
    fireEvent.click(screen.getByText("HomeContent"))
    expect(onPick).toHaveBeenCalledWith({ target: "HomeContent", ui: "" })
  })
})
