import { api } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { waitForClientVersion } from "@/lib/restart-watch"

/*
 * 换版本并等新的一份起来：写指针 → 让这一份退出 → 等监督进程按指针重拉 → 探测到目标版本算成功。
 * 设置页的「切换」和顶上的「有新版」标注共用这一处；连不上的那几秒是预期的，不算失败。
 */

/** 切过去但没起来时的一句统一提示（两个入口都读它，免得同一件事两种说法）。 */
const SWITCH_FAILED_NOTE = "换版本没起来：打开设置 → 更新看原因；还不行就关掉窗口重新双击一次 start.cmd。"

type SwitchOutcome = { ok: boolean; note: string }

async function switchVersionAndWait(version: string): Promise<boolean> {
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

/*
 * 切版本并收尾：成功/失败都说成一句话，两个入口（顶栏标注、设置页那一行）只负责自己的进度态与跳转。
 * 少了这层，同一个协议要在两处各写一遍 try/catch 与「没起来怎么说」。
 */
export async function runSwitch(version: string): Promise<SwitchOutcome> {
  try {
    const up = await switchVersionAndWait(version)
    return up ? { ok: true, note: "" } : { ok: false, note: SWITCH_FAILED_NOTE }
  } catch (error) {
    return { ok: false, note: describeFailure(error) }
  }
}
