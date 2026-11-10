import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { NewTaskCard } from "@/app/new-task-card"
import type { useIdentity } from "@/app/use-identity"
import type { TaskForm } from "@/lib/task-form"

/*
 * 新建任务卡片：走 A 路线时页面 PNG 就在「可选」那一组里。
 * 页面 Target 空着也照给选图 —— 暂存件的键是任务 id，与页面名什么时候认回来无关。
 */

/* 取值链那一套在这一组用例里不参与：给一份不动的壳（IdentityFillPanel 只读它的状态）。 */
const IDENTITY = {
  pages: null,
  derivedUi: "",
  name: "",
  setName: () => undefined,
  candidates: [],
  busy: "",
  pick: () => undefined,
  apply: async () => undefined,
  fill: async () => undefined,
  takeDesignPageName: () => undefined,
  inputs: { link: "", target: "", ui: "", automation: "assist" }
} as unknown as ReturnType<typeof useIdentity>

function form(patch: Partial<TaskForm> = {}): TaskForm {
  return { link: "", projectRoot: "", target: "", ui: "", mode: "A", stopAfter: "", overwrite: false, ...patch }
}

function show(patch: Partial<Parameters<typeof NewTaskCard>[0]> = {}) {
  const { container } = render(
    <NewTaskCard
      form={form()}
      modes={["A", "B", "AB"]}
      onForm={() => undefined}
      plugin={null}
      contract={[]}
      identity={IDENTITY}
      image={null}
      takesPageImage={true}
      startsWithPipelineA={true}
      onPickImage={vi.fn()}
      busy=""
      failure=""
      canStop={false}
      onStart={() => undefined}
      onStop={() => undefined}
      onReloadContract={() => undefined}
      {...patch}
    />
  )
  return Array.from(container.querySelectorAll('input[type="file"]')) as HTMLInputElement[]
}

describe("NewTaskCard 的选图", () => {
  it("走 A 路线时只要求链接、工程目录和页面 PNG", () => {
    const inputs = show()
    expect(inputs.length).toBe(1)
    expect(inputs[0].disabled).toBe(false)
    expect(screen.getByText(/画板原始尺寸导出/)).toBeTruthy()
    expect(screen.getByText("页面 PNG").closest("section")?.textContent).toContain("必填参数")
    expect(screen.getByText("A —— MW WPF XAML 页面")).toBeTruthy()
    expect(screen.queryByLabelText("页面 Target")).toBeNull()
    expect(screen.queryByLabelText("UI 区域")).toBeNull()
    expect(screen.queryByLabelText("停在某一步")).toBeNull()
    expect(screen.getByRole("button", { name: "创建并开始" })).toBeTruthy()
  })

  it("B 路线保留原有 Target/区域与可选参数，但不给选图", () => {
    expect(show({ form: form({ mode: "B" }), takesPageImage: false, startsWithPipelineA: false }).length).toBe(0)
    expect(screen.getByLabelText("页面 Target")).toBeTruthy()
    expect(screen.getByLabelText("UI 区域")).toBeTruthy()
    expect(screen.getByLabelText("停在某一步")).toBeTruthy()
  })

  it("AB 路线同时保留 A 的选图与 B 的身份字段", () => {
    expect(show({ form: form({ mode: "AB" }), takesPageImage: true, startsWithPipelineA: false }).length).toBe(1)
    expect(screen.getByLabelText("页面 Target")).toBeTruthy()
    expect(screen.getByLabelText("UI 区域")).toBeTruthy()
  })
})
