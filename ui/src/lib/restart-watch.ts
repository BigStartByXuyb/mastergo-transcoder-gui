import { api } from "@/lib/api"
import { describeFailure, serviceUpOn } from "@/lib/describe-failure"

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
 * 「失败」有三种，界面要分开对待，所以结论里带上 serviceUp：
 *   被拒（serviceUp=true）—— 后端还在，是它自己说明了原因，更新页也还打得开；
 *   没换成（serviceUp=true）—— 后端一直在答话，只是报的不是目标那一版：它没死，别按死了说；
 *   后端没了（serviceUp=false）—— 界面上任何一页都载不出来，原因只剩客户端那个窗口里那几行。
 *
 * 这三种怎么拼成结论只有这一处（`rejectedOutcome` / `goneOutcome` / `stuckOutcome`）；
 * 调用方只决定「什么时候算终局」。
 */
export type ServiceWaitOptions = {
  /**
   * 探一下新的一份：答话且已经是目标那一版就算通过。
   * 没通过就抛错，并且要把两类失败分开表达（api 层已经分好了）——
   * `ApiFailure("OFFLINE")`＝根本没答话；别的异常＝答了话，只是还不是目标那一版。
   */
  probe: () => Promise<unknown>
  timeoutMs?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** 等到了就是 true；没等到时连「最后一次探测到底有没有人答话」一起交出去。 */
async function waitFor(options: ServiceWaitOptions): Promise<{ ok: boolean; answered: boolean }> {
  const timeoutMs = options.timeoutMs ?? 40000
  const intervalMs = options.intervalMs ?? 300
  const sleep = options.sleep ?? function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }
  const now = options.now ?? function () { return Date.now() }
  const deadline = now() + timeoutMs
  let answered = false

  for (;;) {
    try {
      await options.probe()
      return { ok: true, answered: true }
    }
    catch (error) {
      // 这一份已经退出、下一份还没监听：继续等。以最后一次为准：它是谁答的话，决定最后怎么说。
      answered = serviceUpOn(error)
    }
    if (now() >= deadline) return { ok: false, answered: answered }
    await sleep(intervalMs)
  }
}

export type RestartWaitOptions = {
  /** 等什么：新的一份能答话、或已经是目标版本。没等到的原因由它自己抛。 */
  probe: () => Promise<unknown>
  /** 等不到、并且一次都没人答话（后端已经不在了）时给用户的那句话。 */
  goneNote: string
  /** 等不到、但后端一直在答话（换了，只是没换成目标那一版）时给用户的那句话。 */
  stuckNote: string
  /** 这一条路自己的等待参数（默认按「服务重新答话」那套）。 */
  wait?: Omit<ServiceWaitOptions, "probe">
  restart?: () => Promise<unknown>
}

// 两半都带 serviceUp：起来的那一份在答话，后端当然还在。
export type RestartWaitOutcome = { ok: true; note: ""; serviceUp: true } | { ok: false; note: string; serviceUp: boolean }

/** 被拒：后端答了话，原话只有这一处拼（`describeFailure`），两个入口都调它。 */
export function rejectedOutcome(error: unknown): RestartWaitOutcome {
  return { ok: false, note: describeFailure(error), serviceUp: true }
}

/** 后端已经不在了：只说那一句（原因在客户端窗口里），界面别把人往载不出来的页面带。 */
export function goneOutcome(note: string): RestartWaitOutcome {
  return { ok: false, note: note, serviceUp: false }
}

/** 后端一直在答话、却没换成目标那一版：不是「没了」，更新页还打得开。 */
function stuckOutcome(note: string): RestartWaitOutcome {
  return { ok: false, note: note, serviceUp: true }
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
    if (serviceUpOn(error)) return rejectedOutcome(error)
  }
  const waited = await waitFor(Object.assign({ probe: options.probe }, options.wait || {}))
  if (waited.ok) return { ok: true, note: "", serviceUp: true }
  return waited.answered ? stuckOutcome(options.stuckNote) : goneOutcome(options.goneNote)
}
