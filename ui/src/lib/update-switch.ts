import { api } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { restartAndWait, type RestartWaitOutcome } from "@/lib/restart-watch"

/*
 * 换版本并等新的一份起来：写指针 → 让这一份退出 → 等监督进程按指针重拉 → 探测到目标版本算成功。
 * 设置页的「切换」和顶上的「有新版」标注共用这一处。
 * 「发起重启 → 只把断连当预期 → 等待 → 失败怎么说」这套协议在 lib/restart-watch.ts，这里只写自己的判据。
 */

/** 切过去但没起来时的一句统一提示（两个入口都读它，免得同一件事两种说法）。 */
const SWITCH_FAILED_NOTE = "换版本没起来：打开设置 → 更新看原因；还不行就关掉窗口重新双击一次 start.cmd。"

/*
 * 切版本并收尾：成功/失败都说成一句话，两个入口（顶栏标注、设置页那一行）只负责自己的进度态与跳转。
 * 少了这层，同一件事要在两处各写一遍「没起来怎么说」。
 */
export async function runSwitch(version: string): Promise<RestartWaitOutcome> {
  try {
    await api.updateApply(version)
  } catch (error) {
    return { ok: false, note: describeFailure(error) }
  }
  return restartAndWait({
    probe: async function () {
      const health = await api.health()
      if (health.version !== version) throw new Error("还不是目标版本")
    },
    failedNote: SWITCH_FAILED_NOTE
  })
}
