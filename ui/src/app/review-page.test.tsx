import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewPage } from "@/app/review-page"

vi.mock("@/app/pending-panel", () => ({
  PendingPanel: (props: { mode: string }) => <div data-testid="pending-mode">{props.mode}</div>
}))

vi.mock("@/lib/api", () => ({
  api: {
    pendingList: async () => ({ ok: true, queue: { items: [] } }),
    settingsGet: async () => ({ ok: true, settings: { automation: "assist" } })
  }
}))

afterEach(cleanup)

describe("ReviewPage 的手填条目", () => {
  it("手填时必须带路线，默认按 A 计算布局分组", async () => {
    render(<ReviewPage />)

    fireEvent.change(screen.getByLabelText("工程目录 / 工作目录"), { target: { value: "project-root" } })
    fireEvent.change(screen.getByLabelText("页面 Target"), { target: { value: "F3Demo" } })

    expect((await screen.findByTestId("pending-mode")).textContent).toBe("A")
    expect(screen.getByText("路线")).toBeTruthy()
  })
})
