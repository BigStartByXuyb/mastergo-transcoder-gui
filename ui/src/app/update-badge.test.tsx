import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UpdateBadge } from "@/app/update-badge"
import type { UpdateHint } from "@/lib/api"
import { SERVICE_GONE_NOTE } from "@/lib/describe-failure"
// 切版本那条编排有自己的用例（lib/restart-watch.test.ts）；这里只验这条入口怎么消费它的结论，
// 所以把编排换成假的 —— 真等待是 40 秒起的轮询，挂在界面用例里只会拖垮跑测的时间。
import { runSwitch } from "@/lib/update-switch"

vi.mock("@/lib/update-switch", () => ({ runSwitch: vi.fn() }))

const switchMock = vi.mocked(runSwitch)

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
  switchMock.mockReset()
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

  it("本地有旧一点的下载件、远端更新：目标是远端那一版，点一下是下载它", async () => {
    const staged: string[] = []
    vi.stubGlobal("fetch", (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url)
      if (target.includes("/api/update/stage")) staged.push(String((init && init.body) || ""))
      return ok({ ok: true, started: true, version: "0.6.12", status: {} })
    })
    const onOpenUpdatePage = vi.fn()
    render(
      <UpdateBadge
        update={hint({ state: "download_ready", ready: "0.6.11", availableVersion: "0.6.12" })}
        supervised
        onOpenUpdatePage={onOpenUpdatePage}
      />
    )
    expect(screen.getByText("有新版 v0.6.12")).toBeTruthy()
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(onOpenUpdatePage).toHaveBeenCalled())
    // 点的是「下载远端那一版」，不是「切到手上这份旧的」。
    expect(staged.join("\n")).toContain("0.6.12")
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

  it("切过去没起来（后端也没了）：原地说去哪儿看原因，不把人往更新页带", async () => {
    stub()
    const onOpenUpdatePage = vi.fn()
    switchMock.mockResolvedValue({ ok: false, note: SERVICE_GONE_NOTE, serviceUp: false })
    render(
      <UpdateBadge
        update={hint({ state: "download_ready", ready: "0.6.12" })}
        supervised
        onOpenUpdatePage={onOpenUpdatePage}
      />
    )
    fireEvent.click(screen.getByRole("button"))
    fireEvent.click(await screen.findByRole("button", { name: "切过去" }))
    await waitFor(() => expect(screen.getByText(SERVICE_GONE_NOTE)).toBeTruthy())
    expect(onOpenUpdatePage).not.toHaveBeenCalled()
  })

  it("切过去被后端拒了：如实说，并把人带到更新页看原因", async () => {
    stub()
    const onOpenUpdatePage = vi.fn()
    switchMock.mockResolvedValue({
      ok: false,
      note: "1 次流水线正在跑，现在不能重启客户端：等它跑完再重启。",
      serviceUp: true
    })
    render(
      <UpdateBadge
        update={hint({ state: "download_ready", ready: "0.6.12" })}
        supervised
        onOpenUpdatePage={onOpenUpdatePage}
      />
    )
    fireEvent.click(screen.getByRole("button"))
    fireEvent.click(await screen.findByRole("button", { name: "切过去" }))
    await waitFor(() => expect(onOpenUpdatePage).toHaveBeenCalled())
    expect(screen.getByText(/正在跑/)).toBeTruthy()
  })

  /* 「已经在下载了」不是失败：后端那条任务本来就在跑，这一次点只是来得晚了一步，不发红字。 */
  it("后端说已经在下载了：不发红字，把人带到更新页看进度", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: { code: "BUSY_DOWNLOAD", message: "已经在下载了", hint: "等这一次下载结束。" } }), {
            status: 409
          })
        )
      )
    )
    const onOpenUpdatePage = vi.fn()
    render(<UpdateBadge update={hint()} supervised onOpenUpdatePage={onOpenUpdatePage} />)
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(onOpenUpdatePage).toHaveBeenCalled())
    expect(screen.queryByText(/已经在下载了/)).toBeNull()
  })

  it("下载好之后，上一次那句失败收掉（不留红字）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: false, error: { code: "HTTP_500", message: "下载失败（HTTP 500）", hint: "" } }), {
            status: 500
          })
        )
      )
    )
    const view = render(<UpdateBadge update={hint()} supervised onOpenUpdatePage={vi.fn()} />)
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(screen.getByText(/下载失败/)).toBeTruthy())
    view.rerender(
      <UpdateBadge update={hint({ state: "download_ready", ready: "0.6.12" })} supervised onOpenUpdatePage={vi.fn()} />
    )
    await waitFor(() => expect(screen.queryByText(/下载失败/)).toBeNull())
  })
})
