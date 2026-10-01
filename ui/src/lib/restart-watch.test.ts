import { describe, expect, it } from "vitest"

import { waitForClientVersion, waitForService } from "@/lib/restart-watch"

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

describe("waitForClientVersion", () => {
  it("一探就是目标版本：立刻回真，不再等", async () => {
    const c = clock()
    let calls = 0
    const up = await waitForClientVersion({
      target: "0.4.2",
      probe: async () => {
        calls += 1
        return "0.4.2"
      },
      ...c
    })
    expect(up).toBe(true)
    expect(calls).toBe(1)
  })

  // 老进程退出、新的还没监听的那几秒：连不上是预期的，不算失败。
  it("连不上就继续等，起来了算成功", async () => {
    const c = clock()
    let calls = 0
    const up = await waitForClientVersion({
      target: "0.4.2",
      probe: async () => {
        calls += 1
        if (calls < 3) throw new Error("连不上本地服务")
        return "0.4.2"
      },
      ...c
    })
    expect(up).toBe(true)
    expect(calls).toBe(3)
  })

  it("一直起不来就到点回假", async () => {
    const c = clock()
    let calls = 0
    const up = await waitForClientVersion({
      target: "0.4.2",
      probe: async () => {
        calls += 1
        throw new Error("连不上本地服务")
      },
      timeoutMs: 900,
      intervalMs: 300,
      ...c
    })
    expect(up).toBe(false)
    // 0 / 300 / 600 / 900 四次探测，到点就停。
    expect(calls).toBe(4)
  })

  it("起来的是别的版本：继续等到目标那一版", async () => {
    const c = clock()
    let calls = 0
    const up = await waitForClientVersion({
      target: "0.4.2",
      probe: async () => {
        calls += 1
        return calls < 3 ? "0.4.1" : "0.4.2"
      },
      ...c
    })
    expect(up).toBe(true)
    expect(calls).toBe(3)
  })
})

describe("waitForService", () => {
  it("先等 initialDelayMs 再探，不拿还没退的旧服务当成功", async () => {
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
    // 关键：第一次探测发生在默认的初延迟之后 —— 删掉那句等待，这里就会是 0。
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
})
