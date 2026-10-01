import { describe, expect, it } from "vitest"

import { ApiFailure } from "@/lib/api"
import { restartAndWait, waitForService } from "@/lib/restart-watch"

/* 可控时钟：sleep 往前推时间，now 读它，于是「等多久」在测试里是确定的。 */
function clock() {
  let t = 0
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    }
  }
}

describe("waitForService", () => {
  it("先等初始延迟再探，不拿还没退的旧服务当成功", async () => {
    const c = clock()
    const at: number[] = []
    const up = await waitForService({
      timeoutMs: 0,
      probe: async () => {
        at.push(c.now())
        throw new Error("连不上本地服务")
      },
      ...c
    })
    expect(up).toBe(false)
    // 关键：第一次探测发生在默认的初延迟之后 —— 删掉那句等待，这里就会是 0 而不是 2000。
    expect(at[0]).toBe(2000)
  })

  it("服务一答话就算起来，不再等", async () => {
    const c = clock()
    let calls = 0
    const up = await waitForService({
      probe: async () => {
        calls += 1
        if (calls < 2) throw new Error("还没监听")
        return { ok: true }
      },
      ...c
    })
    expect(up).toBe(true)
    expect(calls).toBe(2)
  })

  it("一直起不来就到点回假", async () => {
    const c = clock()
    let calls = 0
    const up = await waitForService({
      initialDelayMs: 0,
      timeoutMs: 900,
      intervalMs: 300,
      probe: async () => {
        calls += 1
        throw new Error("连不上本地服务")
      },
      ...c
    })
    expect(up).toBe(false)
    // 0 / 300 / 600 / 900 四次探测，到点就停。
    expect(calls).toBe(4)
  })
})

describe("restartAndWait", () => {
  it("断连算预期：继续等，服务回来就算成功", async () => {
    const c = clock()
    let calls = 0
    const outcome = await restartAndWait({
      probe: async () => {
        calls += 1
        if (calls < 3) throw new Error("连不上本地服务")
      },
      failedNote: "没起来",
      restart: async () => {
        throw new ApiFailure("OFFLINE", "连不上本地服务", "")
      },
      wait: { initialDelayMs: 0, ...c }
    })
    expect(outcome).toEqual({ ok: true, note: "" })
    expect(calls).toBe(3)
  })

  it("被拒（有任务在跑 / 不是监督进程拉的）要如实说，不吞掉再白等", async () => {
    let probed = 0
    const outcome = await restartAndWait({
      probe: async () => {
        probed += 1
      },
      failedNote: "没起来",
      restart: async () => {
        throw new ApiFailure("BUSY", "1 次流水线正在跑，现在不能重启客户端", "等它跑完再重启。")
      }
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false ? outcome.note : "").toContain("正在跑")
    expect(probed).toBe(0)
  })

  it("一直起不来就给那一句失败提示", async () => {
    const c = clock()
    const outcome = await restartAndWait({
      probe: async () => {
        throw new Error("连不上本地服务")
      },
      failedNote: "没起来",
      restart: async () => undefined,
      wait: { initialDelayMs: 0, timeoutMs: 0, ...c }
    })
    expect(outcome).toEqual({ ok: false, note: "没起来" })
  })

  it("reloadEnv 原样交给重启那一步", async () => {
    const seen: boolean[] = []
    await restartAndWait({
      reloadEnv: true,
      probe: async () => undefined,
      failedNote: "没起来",
      restart: async (reloadEnv) => {
        seen.push(reloadEnv)
      },
      wait: { initialDelayMs: 0 }
    })
    expect(seen).toEqual([true])
  })
})
