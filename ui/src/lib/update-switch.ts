import { api } from "@/lib/api"
import { waitForClientVersion } from "@/lib/restart-watch"

/*
 * 换版本并等新的一份起来：写指针 → 让这一份退出 → 等监督进程按指针重拉 → 探测到目标版本算成功。
 * 设置页的「切换」和顶上的「有新版」标注共用这一处；连不上的那几秒是预期的，不算失败。
 */

export async function switchVersionAndWait(version: string): Promise<boolean> {
  await api.updateApply(version)
  try {
    await api.clientRestart()
  } catch {
    // 这一份就是被它自己关掉的，请求断在半路属于预期。
  }
  return waitForClientVersion({
    target: version,
    probe: async () => (await api.health()).version
  })
}
