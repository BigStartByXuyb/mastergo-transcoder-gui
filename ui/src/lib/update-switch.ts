import { api } from "@/lib/api"
import { SERVICE_GONE_NOTE } from "@/lib/describe-failure"
import { goneOutcome, rejectedOutcome, restartAndWait, serviceUpOn, type RestartWaitOutcome } from "@/lib/restart-watch"

/*
 * 「换了，只是没换成目标那一版」：后端一直在答话，所以不是「服务没在跑」——
 * 那句会把后端还活着说成死了，还会拦住顶栏标注把人带去更新页。另一种终局（后端真没了）
 * 说的那句在 describe-failure 的 SERVICE_GONE_NOTE，因为顶栏的 offline 分支也读它。
 */
const SWITCH_STUCK_NOTE = "换版本没生效：客户端在跑，报的却不是这一版；看更新页里这一行的状态。"

/*
 * 换版本并等新的一份起来：写指针 → 让这一份退出 → 等监督进程按指针重拉 → 探测到目标版本算成功。
 * 设置页的「切换」和顶上的「有新版」标注共用这一处。
 * 「发起重启 → 只把断连当预期 → 等待 → 失败怎么说」这套协议在 lib/restart-watch.ts，这里只写自己的判据。
 */

/*
 * 切版本并收尾：成功/失败都说成一句话，两个入口（顶栏标注、设置页那一行）只负责自己的进度态与跳转。
 * 少了这层，同一件事要在两处各写一遍「没起来怎么说」。
 */
export async function runSwitch(version: string): Promise<RestartWaitOutcome> {
  try {
    await api.updateApply(version)
  } catch (error) {
    /*
     * 写指针这一步也有两种失败：被后端拒了（有任务在跑、本地那份和清单对不上）＝它还在，原因它自己说得清；
     * 请求断在半路＝它已经没了 —— 与「切过去没起来」是同一件事（都去客户端窗口看原因），说同一句。
     * 「后端还在吗」只有 serviceUpOn 一处判。
     */
    return serviceUpOn(error) ? rejectedOutcome(error) : goneOutcome(SERVICE_GONE_NOTE)
  }
  return restartAndWait({
    probe: async function () {
      const health = await api.health()
      if (health.version !== version) throw new Error("还不是目标版本")
    },
    goneNote: SERVICE_GONE_NOTE,
    stuckNote: SWITCH_STUCK_NOTE
  })
}
