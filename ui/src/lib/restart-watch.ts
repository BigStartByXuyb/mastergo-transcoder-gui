import { ApiFailure, api } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 重启客户端这件事的整套协议，只有这一份：
 *   发起重启 → **只把「被自己关掉」的断连当预期**（被拒要如实说） → 按判据等新的一份 → 失败给一句话。
 *
 * 两个入口共用它：
 *   换版本（还写指针、等版本变成目标那一版）
 *   改完插件根那个环境变量（多带一个 reloadEnv，等本地服务重新答话）
 *
 * 探测、等待、时钟都从外面注入，所以这里能单独测；界面只拿结论。
 * 老进程刚退出、新的还没监听的那一小段连不上是预期的，不算失败，继续等。
 */
export type ServiceWaitOptions = {
  /** 探一下新的一份能不能答话；起不来时抛错即可。 */
  probe: () => Promise<unknown>
  /** 先等一会儿再探。这个时间不计入 timeoutMs（总预算是两者之和）。 */
  initialDelayMs?: number
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
  if (options.initialDelayMs) await sleep(options.initialDelayMs)
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

/*
 * 重启后先等这么久再探：老的一份在响应之后约 50ms 才退出、新的还没监听，
 * 这期间旧进程还能答话，探早了会把「没生效」当成成功。2 秒是本机实测值，写在这里一处。
 * 只有「改插件根那个环境变量」那条路需要它 —— 换版本那条路的判据是版本号，本来就认得出旧进程。
 */
export const RESTART_SETTLE_MS = 2000

export type RestartWaitOptions = {
  /** 等什么：新的一份能答话、或已经是目标版本。没等到的原因由它自己抛。 */
  probe: () => Promise<unknown>
  /** 没等到时给用户的那句话。 */
  failedNote: string
  /** 这次重启要不要顺带重读插件根那个环境变量。 */
  reloadEnv?: boolean
  /** 这一条路自己的等待参数（默认按「服务重新答话」那套）。 */
  wait?: Omit<ServiceWaitOptions, "probe">
  restart?: (reloadEnv: boolean) => Promise<unknown>
}

export type RestartWaitOutcome = { ok: true; note: "" } | { ok: false; note: string }

export async function restartAndWait(options: RestartWaitOptions): Promise<RestartWaitOutcome> {
  const restart = options.restart ?? function (reloadEnv: boolean) { return api.clientRestart(reloadEnv) }
  try {
    await restart(options.reloadEnv === true)
  }
  catch (error) {
    /*
     * 只有「这一份被它自己关掉」才算预期：请求断在半路。
     * 被拒（有任务在跑、这份不是 start.cmd 拉起来的）要如实说，不能吞掉再等 40 秒。
     */
    if (!(error instanceof ApiFailure) || error.code !== "OFFLINE") {
      return { ok: false, note: describeFailure(error) }
    }
  }
  const up = await waitFor(Object.assign({ probe: options.probe }, options.wait || {}))
  return up ? { ok: true, note: "" } : { ok: false, note: options.failedNote }
}
