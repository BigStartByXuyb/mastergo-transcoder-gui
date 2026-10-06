import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"

import { useActionRunner } from "@/app/use-action-runner"
import { useStatusPoll } from "@/app/use-status-poll"
import { finishDownload } from "@/app/download-actions"
import { api, type PluginUpdateStatus } from "@/lib/api"
import { startDownload } from "@/lib/download-run"
import { describePluginInstall } from "@/lib/plugin-install"
import { sourceCheckOutcome } from "@/lib/source-check"
import { isDownloading, isTaskDone } from "@/lib/update-state"

/*
 * 「客户端自带的那一份」这一半：它的状态要一直跟着（表格里那一行要标「有新版」），
 * 检查只拉清单、装是一条后台下载。装完那一下喊一声 onInstalled（父组件据此重读来源清单）。
 *
 * 忙碌位用的是这两把 key。来源清单那一半（use-plugin-sources）用的是那里每一行的 id，
 * 两边最后会合成一个字符串给界面看（卡片上合成、面板里判「是哪一个在跑」），所以带上 update: 前缀，
 * 免得自带那一行的 id（也叫 install）与这里装插件那把 key 撞名、两颗按钮一起转圈。
 */
export const PLUGIN_UPDATE_KEYS = { check: "update:check", install: "update:install" } as const

export function usePluginUpdate(onInstalled: () => void) {
  const [update, setUpdate] = useState<PluginUpdateStatus | null>(null)
  const [probe, setProbe] = useState("")
  const [failure, setFailure] = useState("")
  const [working, setWorking] = useState("")
  /*
   * 最近一次失败的原话。动作骨架（use-action-runner）只把话写进状态，而「保存并检查」那一下要把
   * 同一句话原样交给弹窗 —— 所以这里顺手留一份，弹窗与卡片说的因此是同一句。
   */
  const failureRef = useRef("")
  const rememberFailure = useCallback(function (message: string) {
    failureRef.current = message
    setFailure(message)
  }, [])

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

  useStatusPoll({
    load: () => api.pluginUpdateStatus(),
    working: transferring,
    onData: (payload) => adopt(payload.status),
    onError: setProbe
  })

  // 动作骨架与另外三张卡同一处（use-action-runner）：置 working → 清旧错 → 跑 → 套状态 → 收尾。
  const act = useActionRunner<PluginUpdateStatus>({ setWorking: setWorking, setFailure: rememberFailure, setStatus: setUpdate })

  /* 立刻重读一次状态：改完发布源要马上看到这一份说的是新地址（同一条取数，不另拼请求）。 */
  const refresh = useCallback(async function () {
    const payload = await api.pluginUpdateStatus()
    adopt(payload.status)
    return payload.status
  }, [adopt])

  /*
   * 卡片上那颗「检查更新」：与「程序更新」那张卡同形（act 套状态，这里只顺手清掉轮询留下的提示）。
   */
  const check = useCallback(
    () =>
      act(PLUGIN_UPDATE_KEYS.check, async function () {
        const payload = await api.pluginUpdateCheck()
        setProbe("")
        return payload
      }),
    [act]
  )

  /*
   * 「保存并检查」用的那一次：走同一个接口、同一套说法（describePluginInstall），
   * 只是要把结果说成弹窗要的两句话，所以这里不返回状态而返回那两句话。
   */
  const checkOutcome = useCallback(async function () {
    const payload = await act(PLUGIN_UPDATE_KEYS.check, () => api.pluginUpdateCheck())
    if (!payload) return { failure: failureRef.current, note: "" }
    return sourceCheckOutcome(describePluginInstall(payload.status), payload.status.state === "error")
  }, [act])

  // 装最新那一版：与另外三条下载线同形（startDownload 归一结果 → finishDownload 按 kind 落地）。
  const install = useCallback(
    () =>
      act(
        PLUGIN_UPDATE_KEYS.install,
        () => startDownload(() => api.pluginUpdateInstall()),
        (payload) =>
          finishDownload(payload, {
            setFailure: rememberFailure,
            onStarted: () =>
              toast.info("开始装插件 v" + (payload.status && payload.status.available ? payload.status.available.version : ""))
          })
      ),
    [act, rememberFailure]
  )

  return {
    update: update,
    probe: probe,
    failure: failure,
    busy: working,
    check: check,
    checkOutcome: checkOutcome,
    refresh: refresh,
    install: install
  }
}
