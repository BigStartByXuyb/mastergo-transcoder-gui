/*
 * 换版本之后等新的那份起来：轮询版本号，直到它变成目标那一版。
 *
 * 探测、等待、时钟都从外面注入，所以这里能单独测；界面只拿结论（起没起来）。
 * 老进程刚退出、新的还没监听的那一小段连不上是预期的，不算失败，继续等。
 */
export type WaitOptions = {
  /** 取当前版本号；起不来时抛错即可。 */
  probe: () => Promise<string>
  target: string
  timeoutMs?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export async function waitForClientVersion(options: WaitOptions): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 40000
  const intervalMs = options.intervalMs ?? 300
  const sleep = options.sleep ?? function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }
  const now = options.now ?? function () { return Date.now() }
  const deadline = now() + timeoutMs

  for (;;) {
    try {
      if ((await options.probe()) === options.target) return true
    }
    catch {
      // 这一份已经退出、下一份还没监听：继续等。
    }
    if (now() >= deadline) return false
    await sleep(intervalMs)
  }
}
