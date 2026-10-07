import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"

import { useActionRunner } from "@/app/use-action-runner"
import { useFailureMemory } from "@/app/use-failure-memory"
import { useStatusPoll } from "@/app/use-status-poll"
import { finishDownload } from "@/app/download-actions"
import { api, type PluginUpdateStatus } from "@/lib/api"
import { startDownload } from "@/lib/download-run"
import { describePluginInstall } from "@/lib/plugin-install"
import { PLUGIN_BUSY } from "@/lib/plugin-sources"
import { sourceCheckOutcomeOf } from "@/lib/source-check"
import { busyNow, isDownloading, isTaskDone } from "@/lib/update-state"

/*
 * 「客户端自带的那一份」这一半：它的状态要一直跟着（表格里那一行要标「有新版」），
 * 检查只拉清单、装是一条后台下载。装完那一下喊一声 onInstalled（父组件据此重读来源清单）。
 *
 * 忙碌位只报「这一半」的 key（PLUGIN_BUSY 的 check / install，表在 lib/plugin-sources 一处）：
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
    const payload = await reload()
    if (!payload) throw new Error("读不到插件状态")
    return payload.status
  }, [reload])

  /*
   * 跑一次检查（act 骨架）：与「程序更新」那张卡同形，顺手清掉轮询留下的提示。
   * 卡片上那颗与「保存并检查」那一下都走这一条 —— 两条路只有「结果怎么说」不同。
   */
  const runCheck = useCallback(
    () => act(PLUGIN_BUSY.check, () => api.pluginUpdateCheck()),
    [act]
  )

  /** 卡片上那颗「检查更新」。 */
  const check = runCheck

  /*
   * 「保存并检查」用的那一次：走同一个接口、同一套说法（describePluginInstall），
   * 只是要把结果说成弹窗要的两句话，所以这里不返回状态而返回那两句话。
   */
  const checkOutcome = useCallback(async function () {
    const payload = await runCheck()
    return sourceCheckOutcomeOf(payload, failureMemory.last(), describePluginInstall, (next) => next.state === "error")
  }, [runCheck, failureMemory])

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
   * 卡片上那颗与「管理…」面板里那颗是同一个动作，所以读同一个判据，不各写一份禁用条件。
   */
  const busy = busyNow([{ busy: working, transferring }, { busy: update ? update.busy : "" }])
  const canCheck = Boolean(update) && !busy

  return {
    update: update,
    /** 正在传（下载/落盘）：卡片与面板据此一起冻住「换一份 / 改发布源」。 */
    transferring: transferring,
    probe: probe,
    failure: failure,
    busy: working,
    canCheck: canCheck,
    check: check,
    checkOutcome: checkOutcome,
    refresh: refresh,
    install: install
  }
}
