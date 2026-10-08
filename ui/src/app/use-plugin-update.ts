import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"

import { useActionRunner } from "@/app/use-action-runner"
import { useFailureMemory } from "@/app/use-failure-memory"
import { useStatusPoll } from "@/app/use-status-poll"
import { finishDownload } from "@/app/download-actions"
import { api, type PluginUpdateStatus } from "@/lib/api"
import { startDownload } from "@/lib/download-run"
import { describePluginInstall } from "@/lib/plugin-install"
import { PLUGIN_BUSY } from "@/lib/plugin-busy"
import { requireStatus, sourceCheckOutcomeOf } from "@/lib/source-check"
import { busyNow, isDownloading, isTaskDone } from "@/lib/update-state"

/*
 * 「客户端自带的那一份」这一半：它的状态要一直跟着（表格里那一行要标「有新版」），
 * 检查只拉清单、装是一条后台下载。装完那一下喊一声 onInstalled（父组件据此重读来源清单）。
 *
 * 忙碌位只报「这一半」的 key（PLUGIN_BUSY 的 check / install，表在 lib/plugin-busy 一处）：
 * 来源清单那一半也有自己的忙碌位，两边各报各的，由卡片分别交给界面，不合成成同一个字符串。
 */

export function usePluginUpdate(onInstalled: () => void) {
  const [update, setUpdate] = useState<PluginUpdateStatus | null>(null)
  const [probe, setProbe] = useState("")
  const [failure, setFailure] = useState("")
  const [working, setWorking] = useState("")
  // 失败原话的记忆在 app/use-failure-memory（两半共用），动作骨架照旧写状态。
  const failureMemory = useFailureMemory(setFailure)

  // 「正在传」的判据只有 update-state.isDownloading 一处（面板里那颗进度条读的也是它）。
  const transferring = update ? isDownloading(update.task) : false
  // 回调放 ref 里：轮询的取数路径不跟着父组件重渲染换闭包。
  const installed = useRef(onInstalled)
  installed.current = onInstalled
  const lastPhase = useRef("")

  /*
   * 读一次状态并落到界面：轮询与「改完发布源立刻重读」都走这一条。
   * 「装完了」那一下也在这里判（父组件据此重读来源清单），两条路不会一条刷新、一条不刷新。
   */
  const adopt = useCallback(function (status: PluginUpdateStatus) {
    const done = isTaskDone(status.task) && lastPhase.current !== "done"
    lastPhase.current = status.task.phase
    setUpdate(status)
    setProbe("")
    if (done) installed.current()
  }, [])

  // 轮询与下面的「立刻重读」是同一段取数路径（reload 就是轮询那一跳，含卸载守卫）。
  const { reload } = useStatusPoll({
    load: () => api.pluginUpdateStatus(),
    working: transferring,
    onData: (payload) => adopt(payload.status),
    onError: setProbe
  })

  /*
   * 动作骨架与另外三张卡同一处（use-action-runner）：置 working → 清旧错 → 跑 → 套状态 → 收尾。
   * 落地交给 adopt：动作与轮询因此走同一条落地路径（「装完了」那一下两条路都会判到）。
   */
  const act = useActionRunner<PluginUpdateStatus>({
    setWorking: setWorking,
    setFailure: failureMemory.remember,
    setStatus: adopt
  })

  /*
   * 立刻重读一次状态：改完发布源要马上看到这一份说的是新地址。
   * 走轮询那一跳（useStatusPoll 的 reload），不另拼一条取数 —— 两边的落地与守卫因此只有一处。
   */
  const refresh = useCallback(async function () {
    // 「拿不到就照实报错」这一句在 lib/source-check（两半共用）。
    return requireStatus(await reload(), "插件状态").status
  }, [reload])

  /*
   * 「检查更新」只有这一个入口：自带那一行的「管理…」面板里那颗按钮与「保存并检查」都调它。
   * 它走这一条线的动作骨架（忙碌位与别处一致），返回弹窗要的那两句话（面板里那颗按钮不看返回值）；
   * 「怎么说」归 describePluginInstall 一处，没拿到结果时用刚才记住的那句原话。
   */
  const check = useCallback(async function () {
    const payload = await act(PLUGIN_BUSY.check, () => api.pluginUpdateCheck())
    return sourceCheckOutcomeOf(payload, failureMemory.last(), describePluginInstall, (next) => next.state === "error")
  }, [act, failureMemory])

  // 装最新那一版：与另外三条下载线同形（startDownload 归一结果 → finishDownload 按 kind 落地）。
  const install = useCallback(
    () =>
      act(
        PLUGIN_BUSY.install,
        () => startDownload(() => api.pluginUpdateInstall()),
        (payload) =>
          finishDownload(payload, {
            setFailure: failureMemory.remember,
            onStarted: () =>
              toast.info("开始装插件 v" + (payload.status && payload.status.available ? payload.status.available.version : ""))
          })
      ),
    [act, failureMemory]
  )

  /*
   * 「检查更新」能不能点：这一条线自己有没有动作在跑、正在传、后端有没有别的任务在跑。
   * 只读动作，所以不等来源清单那一半；装那一颗更严（写盘，见 plugin-install-block 里 `frozen` 那条注释）。
   */
  const workingNow = busyNow([{ busy: working, transferring }, { busy: update ? update.busy : "" }])
  const canCheck = Boolean(update) && !workingNow

  return {
    update: update,
    /** 正在传（下载/落盘）：卡片与面板据此一起冻住「改发布源 / 装新版」。 */
    transferring: transferring,
    probe: probe,
    failure: failure,
    busy: working,
    canCheck: canCheck,
    check: check,
    refresh: refresh,
    install: install
  }
}
