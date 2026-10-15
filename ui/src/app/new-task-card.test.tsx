import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { NewTaskCard } from "@/app/new-task-card"
import type { useIdentity } from "@/app/use-identity"
import type { TaskForm } from "@/lib/task-form"

/*
 * 新建任务卡片：走 A 路线时设计稿位图就在「可选」那一组里。
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
      onForm={() => undefined}
      plugin={null}
      contract={[]}
      identity={IDENTITY}
      image={null}
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
  it("走 A 路线、页面 Target 空着也给选图框（而且不是禁用的）", () => {
    const inputs = show()
    expect(inputs.length).toBe(1)
    expect(inputs[0].disabled).toBe(false)
    expect(screen.getByText(/按设计稿原尺寸导出/)).toBeTruthy()
  })

  it("不跑 A 路线就不给选图", () => {
    expect(show({ form: form({ mode: "B" }) }).length).toBe(0)
  })
})
