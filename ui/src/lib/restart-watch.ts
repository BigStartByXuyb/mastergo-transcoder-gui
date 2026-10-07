import { ApiFailure, api } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 重启客户端这件事的整套协议，只有这一份：
 *   发起重启 → **只把「被自己关掉」的断连当预期**（被拒要如实说） → 按判据等新的一份 → 失败给一句话。
 *
 * 换版本那条路用它（设置页的「切换」与顶上的「有新版」标注共用一处编排）：写完指针发起重启，
 * 再按「已经是目标版本」探活 —— 这个判据本来就认得出旧进程，所以不用先等旧的那份退干净。
 *
 * 探测、等待、时钟都从外面注入，所以这里能单独测；界面只拿结论。
 * 老进程刚退出、新的还没监听的那一小段连不上是预期的，不算失败，继续等。
 *
 * 「失败」有两种，界面要分开对待，所以结论里带上 serviceUp：
 *   被拒（serviceUp=true）—— 后端还在，是它自己说明了原因，更新页也还打得开；
 *   等不到（serviceUp=false）—— 后端已经不在了，界面上任何一页都载不出来，原因只剩客户端那个窗口里那几行。
 */
export type ServiceWaitOptions = {
  /** 探一下新的一份能不能答话；起不来时抛错即可。 */
  probe: () => Promise<unknown>
  timeoutMs?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

async function waitFor(options: ServiceWaitOptions): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 40000
  const intervalMs = options.intervalMs ?? 300
  const sleep = options.sleep ?? function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }
  const now = options.now ?? function () { return Date.now() }
  const deadline = now() + timeoutMs

  for (;;) {
    try {
      await options.probe()
      return true
    }
    catch {
      // 这一份已经退出、下一份还没监听：继续等。
    }
    if (now() >= deadline) return false
    await sleep(intervalMs)
  }
}

export type RestartWaitOptions = {
  /** 等什么：新的一份能答话、或已经是目标版本。没等到的原因由它自己抛。 */
  probe: () => Promise<unknown>
  /** 没等到时给用户的那句话。 */
  failedNote: string
  /** 这一条路自己的等待参数（默认按「服务重新答话」那套）。 */
  wait?: Omit<ServiceWaitOptions, "probe">
  restart?: () => Promise<unknown>
}

// 两半都带 serviceUp：起来的那一份在答话，后端当然还在。
export type RestartWaitOutcome = { ok: true; note: ""; serviceUp: true } | { ok: false; note: string; serviceUp: boolean }

/*
 * 「这个异常说明后端还在吗」只有这一处：请求断在半路（api 层一律折成 OFFLINE）＝已经不在；
 * 后端答了话（哪怕是拒绝，像有任务在跑、本地那份和清单对不上）＝还在。
 * 谁要据此决定「还要不要把人带到某一页」，都读这一条。
 */
export function serviceUpOn(error: unknown): boolean {
  return !(error instanceof ApiFailure && error.code === "OFFLINE")
}

export async function restartAndWait(options: RestartWaitOptions): Promise<RestartWaitOutcome> {
  const restart = options.restart ?? function () { return api.clientRestart() }
  try {
    await restart()
  }
  catch (error) {
    /*
     * 只有「这一份被它自己关掉」才算预期：请求断在半路。
     * 被拒（有任务在跑、没有监督进程）要如实说，不能吞掉再等 40 秒
     * —— 能走到这里说明后端答了话，它还在，更新页还开得出来。
     */
    if (serviceUpOn(error)) {
      return { ok: false, note: describeFailure(error), serviceUp: true }
    }
  }
  const up = await waitFor(Object.assign({ probe: options.probe }, options.wait || {}))
  return up ? { ok: true, note: "", serviceUp: true } : { ok: false, note: options.failedNote, serviceUp: false }
}
