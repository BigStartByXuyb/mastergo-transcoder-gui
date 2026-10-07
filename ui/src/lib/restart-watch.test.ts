import { describe, expect, it } from "vitest"

import { ApiFailure } from "@/lib/api"
import { restartAndWait } from "@/lib/restart-watch"

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

describe("restartAndWait", () => {
  it("服务一答话就算起来，不再等", async () => {
    const c = clock()
    let calls = 0
    const outcome = await restartAndWait({
      probe: async () => {
        calls += 1
        if (calls < 2) throw new Error("还没监听")
      },
      goneNote: "没了",
      stuckNote: "没换成",
      restart: async () => undefined,
      wait: { ...c }
    })
    expect(outcome).toEqual({ ok: true, note: "", serviceUp: true })
    expect(calls).toBe(2)
  })

  it("一直连不上（没人答话）就到点回假，说「后端没了」那句", async () => {
    const c = clock()
    let calls = 0
    const outcome = await restartAndWait({
      probe: async () => {
        calls += 1
        throw new ApiFailure("OFFLINE", "连不上本地服务", "Failed to fetch")
      },
      goneNote: "没了",
      stuckNote: "没换成",
      restart: async () => undefined,
      wait: { timeoutMs: 900, intervalMs: 300, ...c }
    })
    expect(outcome.ok).toBe(false)
    expect(outcome).toEqual({ ok: false, note: "没了", serviceUp: false })
    // 0 / 300 / 600 / 900 四次探测，到点就停。
    expect(calls).toBe(4)
  })

  it("后端一直在答话、只是没换成目标那一版：别按「没了」说，更新页还打得开", async () => {
    const c = clock()
    const outcome = await restartAndWait({
      probe: async () => {
        // health 答了话、报的还是旧版本（runSwitch 的探测就是这么抛的）。
        throw new Error("还不是目标版本")
      },
      goneNote: "没了",
      stuckNote: "没换成",
      restart: async () => undefined,
      wait: { timeoutMs: 0, ...c }
    })
    expect(outcome).toEqual({ ok: false, note: "没换成", serviceUp: true })
  })

  it("断连算预期：继续等，服务回来就算成功", async () => {
    const c = clock()
    let calls = 0
    const outcome = await restartAndWait({
      probe: async () => {
        calls += 1
        // 「连不上」按契约只能写成 OFFLINE：普通 Error 表示「答了话、只是还不是目标那一版」。
        if (calls < 3) throw new ApiFailure("OFFLINE", "连不上本地服务", "Failed to fetch")
      },
      goneNote: "没了",
      stuckNote: "没换成",
      restart: async () => {
        throw new ApiFailure("OFFLINE", "连不上本地服务", "")
      },
      wait: { ...c }
    })
    expect(outcome).toEqual({ ok: true, note: "", serviceUp: true })
    expect(calls).toBe(3)
  })

  it("被拒（有任务在跑 / 不是监督进程拉的）要如实说，不吞掉再白等", async () => {
    let probed = 0
    const outcome = await restartAndWait({
      probe: async () => {
        probed += 1
      },
      goneNote: "没了",
      stuckNote: "没换成",
      restart: async () => {
        throw new ApiFailure("BUSY", "1 次流水线正在跑，现在不能重启客户端", "等它跑完再重启。")
      }
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false ? outcome.note : "").toContain("正在跑")
    // 后端答了话说明它还在：界面还能带人去看原因。
    expect(outcome.ok === false ? outcome.serviceUp : null).toBe(true)
    expect(probed).toBe(0)
  })

  it("一直起不来就给那一句失败提示", async () => {
    const c = clock()
    const outcome = await restartAndWait({
      probe: async () => {
        throw new ApiFailure("OFFLINE", "连不上本地服务", "")
      },
      goneNote: "没了",
      stuckNote: "没换成",
      restart: async () => undefined,
      wait: { timeoutMs: 0, ...c }
    })
    // 等不到 = 新的一份没起来，后端也不在了：调用方不能再把人往更新页带。
    expect(outcome).toEqual({ ok: false, note: "没了", serviceUp: false })
  })

})

