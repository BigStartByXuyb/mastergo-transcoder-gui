import { api } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { restartAndWait, serviceUpOn, type RestartWaitOutcome } from "@/lib/restart-watch"

/*
 * 换版本并等新的一份起来：写指针 → 让这一份退出 → 等监督进程按指针重拉 → 探测到目标版本算成功。
 * 设置页的「切换」和顶上的「有新版」标注共用这一处。
 * 「发起重启 → 只把断连当预期 → 等待 → 失败怎么说」这套协议在 lib/restart-watch.ts，这里只写自己的判据。
 */

/*
 * 切过去但没起来时的一句统一提示（两个入口都读它，免得同一件事两种说法）。
 * 这时候后端已经不在，界面上任何一页都载不出来 —— 只能指客户端那个窗口（原因写在它里面）。
 */
const SWITCH_FAILED_NOTE = "换版本没起来：看一下客户端那个窗口里打印的原因；把它关掉再打开一次，就会进新版本。"

/*
 * 切版本并收尾：成功/失败都说成一句话，两个入口（顶栏标注、设置页那一行）只负责自己的进度态与跳转。
 * 少了这层，同一件事要在两处各写一遍「没起来怎么说」。
 */
export async function runSwitch(version: string): Promise<RestartWaitOutcome> {
  try {
    await api.updateApply(version)
  } catch (error) {
    /*
     * 写指针这一步也有两种失败：被后端拒了（有任务在跑、本地那份和清单对不上）＝它还在，
     * 原因它自己说得清；请求断在半路＝它已经没了，别再说还在（「后端还在吗」只有 serviceUpOn 一处判）。
     */
    return { ok: false, note: describeFailure(error), serviceUp: serviceUpOn(error) }
  }
  return restartAndWait({
    probe: async function () {
      const health = await api.health()
      if (health.version !== version) throw new Error("还不是目标版本")
    },
    failedNote: SWITCH_FAILED_NOTE
  })
}
