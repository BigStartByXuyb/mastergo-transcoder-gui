import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UpdateBadge } from "@/app/update-badge"
import type { UpdateHint } from "@/lib/api"

/*
 * 走真的 api 层（只把 fetch 换掉）：要验的是「什么状态挂出来、点一下发哪个请求」。
 */

function hint(patch: Partial<UpdateHint> = {}): UpdateHint {
  return {
    state: "update_available",
    current: "0.6.11",
    ready: "",
    busy: "",
    availableVersion: "0.6.12",
    stagedFreshRunRequired: null,
    ...patch
  }
}

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

function stub() {
  const mock = vi.fn((url: string) => {
    if (String(url).includes("/api/update/stage")) return ok({ ok: true, started: true, version: "0.6.12", status: {} })
    return ok({ ok: true })
  })
  vi.stubGlobal("fetch", mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("UpdateBadge", () => {
  it("没有新版就不挂东西", () => {
    const { container } = render(
      <UpdateBadge update={hint({ state: "up_to_date" })} supervised onOpenUpdatePage={vi.fn()} />
    )
    expect(container.textContent).toBe("")
  })

  it("service 没读到状态也不挂", () => {
    const { container } = render(<UpdateBadge update={undefined} supervised onOpenUpdatePage={vi.fn()} />)
    expect(container.textContent).toBe("")
  })

  it("有新版：点一下开始下载，并把人带到更新页", async () => {
    const mock = stub()
    const onOpenUpdatePage = vi.fn()
    render(<UpdateBadge update={hint()} supervised onOpenUpdatePage={onOpenUpdatePage} />)
    expect(screen.getByText("有新版 v0.6.12")).toBeTruthy()
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(onOpenUpdatePage).toHaveBeenCalled())
    expect(mock.mock.calls.some((call) => String(call[0]).includes("/api/update/stage"))).toBe(true)
  })

  it("下载好了：文字变成可切换", () => {
    render(
      <UpdateBadge
        update={hint({ state: "download_ready", ready: "0.6.12" })}
        supervised={false}
        onOpenUpdatePage={vi.fn()}
      />
    )
    expect(screen.getByText("可切到 v0.6.12")).toBeTruthy()
  })

  it("没有监督进程时不在标注里切换，而是把人带到更新页", async () => {
    const mock = stub()
    const onOpenUpdatePage = vi.fn()
    render(
      <UpdateBadge update={hint({ state: "download_ready", ready: "0.6.12" })} supervised={false} onOpenUpdatePage={onOpenUpdatePage} />
    )
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(onOpenUpdatePage).toHaveBeenCalled())
    expect(mock.mock.calls.some((call) => String(call[0]).includes("/api/update/apply"))).toBe(false)
  })

  it("有任务在跑时，确认弹窗里说清并挡住「切过去」", async () => {
    stub()
    render(
      <UpdateBadge
        update={hint({ state: "download_ready", ready: "0.6.12", busy: "1 次流水线正在跑" })}
        supervised
        onOpenUpdatePage={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(screen.getByText(/现在有任务在跑/)).toBeTruthy())
    expect((screen.getByRole("button", { name: "切过去" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
