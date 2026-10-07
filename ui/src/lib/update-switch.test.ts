import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiFailure, api } from "@/lib/api"
import { runSwitch } from "@/lib/update-switch"

/*
 * 只把 api 那层换成假的：要验的是「写指针这一步失败时，后端还在吗」这条判据 ——
 * 它决定顶栏标注还要不要把人带到更新页，所以两种失败各钉一条。
 * 真编排（发起重启 → 等新的一份）在 restart-watch.test.ts 里另有用例，这里不重复。
 */
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return { ...actual, api: { ...actual.api, updateApply: vi.fn() } }
})

afterEach(() => {
  vi.mocked(api.updateApply).mockReset()
})

describe("runSwitch", () => {
  it("写指针那一步断在半路（后端已经没了）：不说它还在", async () => {
    vi.mocked(api.updateApply).mockRejectedValue(
      new ApiFailure("OFFLINE", "连不上本地服务", "Failed to fetch")
    )
    const outcome = await runSwitch("0.6.12")
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false ? outcome.serviceUp : null).toBe(false)
  })

  it("写指针被后端拒了：它还在，原话如实说", async () => {
    vi.mocked(api.updateApply).mockRejectedValue(
      new ApiFailure("BUSY", "1 次流水线正在跑，现在不能换版本", "等它跑完再换。")
    )
    const outcome = await runSwitch("0.6.12")
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false ? outcome.serviceUp : null).toBe(true)
    expect(outcome.ok === false ? outcome.note : "").toContain("正在跑")
  })
})
