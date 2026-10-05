import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SourceDialog } from "@/app/source-dialog"
import type { UpdateStatus } from "@/lib/api"

/*
 * 走真的 api 层（只把 fetch 换掉）：要验的是「预填什么、点保存并检查发哪两个请求、结果怎么显示」。
 */

const BASE = "https://github.com/BigStartByXuyb/mastergo-transcoder-gui"

function status(patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    state: "up_to_date",
    current: "0.6.31",
    currentNotes: [],
    history: [],
    root: "",
    pointer: null,
    busy: "",
    staged: [],
    ready: "",
    rollback: "",
    available: null,
    error: null,
    task: { phase: "idle", done: 0, total: 0, downloaded: 0, error: null },
    source: {
      kind: "github",
      base: BASE,
      manifestUrl: BASE + "/releases/latest/download/manifest.json",
      kinds: ["github", "gitlab", "static"]
    },
    hasToken: false,
    ...patch
  }
}

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

function stub() {
  const seen: { url: string; body: unknown }[] = []
  const mock = vi.fn((url: string, init?: RequestInit) => {
    const target = String(url)
    seen.push({ url: target, body: init && init.body ? JSON.parse(String(init.body)) : null })
    if (target.includes("/api/settings")) return ok({ ok: true, settings: {} })
    if (target.includes("/api/update/check")) {
      return ok({
        ok: true,
        status: status({
          state: "update_available",
          available: {
            version: "0.6.32",
            notes: [],
            releasedAt: "2026-10-05T00:00:00.000Z",
            minClientVersion: "",
            freshRunRequired: true,
            changed: 2,
            removed: 0,
            total: 63,
            blocked: null,
            checkedAt: "2026-10-05T00:00:00.000Z"
          }
        })
      })
    }
    return ok({ ok: true, status: status() })
  })
  vi.stubGlobal("fetch", mock)
  return seen
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SourceDialog", () => {
  it("按现状预填，点保存并检查先存后验，并把结果回报给外层", async () => {
    const seen = stub()
    const onStatus = vi.fn()
    render(<SourceDialog status={status()} onClose={() => undefined} onStatus={onStatus} />)

    expect(screen.getByLabelText("发布源类型").textContent).toContain("GitHub 仓库")
    expect((screen.getByLabelText("地址") as HTMLInputElement).value).toBe(BASE)
    expect(screen.getByText(BASE + "/releases/latest/download/manifest.json")).toBeTruthy()

    fireEvent.change(screen.getByLabelText("地址"), { target: { value: "https://git.example.com/team/gui" } })
    fireEvent.click(screen.getByRole("button", { name: "保存并检查" }))

    // 报的这句话与「程序更新」卡片同一处口径（describeUpdate），不另写一套。
    await waitFor(() => expect(screen.getByText("有新版本 v0.6.32")).toBeTruthy())
    const saved = seen.find((item) => item.url.includes("/api/settings"))
    expect(saved?.body).toEqual({ source: { kind: "github", base: "https://git.example.com/team/gui", token: "" } })
    expect(seen.some((item) => item.url.includes("/api/update/check"))).toBe(true)
    expect(onStatus).toHaveBeenCalled()
  })

  it("检查失败时把原因与提示原样说出来（与卡片同一句话）", async () => {
    const mock = vi.fn((url: string) => {
      const target = String(url)
      if (target.includes("/api/settings")) return ok({ ok: true, settings: {} })
      if (target.includes("/api/update/check")) {
        return ok({
          ok: true,
          status: status({
            state: "error",
            error: { code: "HTTP_401", message: "检查更新失败（HTTP 401）", hint: "私有源要填 token" }
          })
        })
      }
      return ok({ ok: true, status: status() })
    })
    vi.stubGlobal("fetch", mock)

    render(<SourceDialog status={status()} onClose={() => undefined} onStatus={() => undefined} />)
    fireEvent.click(screen.getByRole("button", { name: "保存并检查" }))

    await waitFor(() => expect(screen.getByText("检查更新失败（HTTP 401）：私有源要填 token")).toBeTruthy())
  })
})
