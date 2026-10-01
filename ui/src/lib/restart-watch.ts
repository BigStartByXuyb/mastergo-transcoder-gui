/*
 * 重启之后等新的那份起来：轮询一个判据，直到它成立。
 *
 * 探测、等待、时钟都从外面注入，所以这里能单独测；界面只拿结论（起没起来）。
 * 老进程刚退出、新的还没监听的那一小段连不上是预期的，不算失败，继续等。
 *
 * 两个入口：等版本变成目标那一版（换版本）、等本地服务能答话（改完插件根环境变量重启）。
 * 轮询骨架只有这一份，deadline 与间隔的默认值也在这里，别处不要再写死一套。
 */
export type ServiceWaitOptions = {
  /** 探一下新的一份能不能答话；起不来时抛错即可。 */
  probe: () => Promise<unknown>
  /** 先等一会儿再探：老的一份要被收掉、新的还没监听（本机实测约 2 秒）。 */
  initialDelayMs?: number
  timeoutMs?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export type WaitOptions = Omit<ServiceWaitOptions, "probe"> & {
  /** 取当前版本号；起不来时抛错即可。 */
  probe: () => Promise<string>
  target: string
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

/** 等本地服务能答话（不比对版本）：改完插件根那个环境变量重启之后用。 */
export async function waitForService(options: ServiceWaitOptions): Promise<boolean> {
  return waitFor(options)
}

export async function waitForClientVersion(options: WaitOptions): Promise<boolean> {
  return waitFor({
    ...options,
    probe: async function () {
      if ((await options.probe()) !== options.target) throw new Error("还不是目标版本")
    }
  })
}
