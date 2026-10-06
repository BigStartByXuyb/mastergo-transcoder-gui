import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"

import { useActionRunner } from "@/app/use-action-runner"
import { useStatusPoll } from "@/app/use-status-poll"
import { finishDownload } from "@/app/download-actions"
import { api, type PluginUpdateStatus } from "@/lib/api"
import { startDownload } from "@/lib/download-run"
import { describePluginInstall } from "@/lib/plugin-install"
import { sourceCheckOutcome } from "@/lib/source-check"
import { isTaskDone } from "@/lib/update-state"

/*
 * 「客户端自带的那一份」这一半：它的状态要一直跟着（表格里那一行要标「有新版」），
 * 检查只拉清单、装是一条后台下载。装完那一下喊一声 onInstalled（父组件据此重读来源清单）。
 */

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

  const transferring = update ? update.task.phase === "downloading" || update.task.phase === "materializing" : false
  // 回调放 ref 里：轮询的取数路径不跟着父组件重渲染换闭包。
  const installed = useRef(onInstalled)
  installed.current = onInstalled
  const lastPhase = useRef("")

  useStatusPoll({
    load: () => api.pluginUpdateStatus(),
    working: transferring,
    onData: (payload) => {
      const done = isTaskDone(payload.status.task) && lastPhase.current !== "done"
      lastPhase.current = payload.status.task.phase
      setUpdate(payload.status)
      setProbe("")
      if (done) installed.current()
    },
    onError: setProbe
  })

  // 动作骨架与另外三张卡同一处（use-action-runner）：置 working → 清旧错 → 跑 → 套状态 → 收尾。
  const act = useActionRunner<PluginUpdateStatus>({ setWorking: setWorking, setFailure: rememberFailure, setStatus: setUpdate })

  /* 立刻重读一次状态：改完发布源要马上看到这一份说的是新地址（同一条取数，不另拼请求）。 */
  const refresh = useCallback(async function () {
    const payload = await api.pluginUpdateStatus()
    setUpdate(payload.status)
    setProbe("")
    return payload.status
  }, [])

  /*
   * 卡片上那颗「检查更新」：与「程序更新」那张卡同形（act 套状态，这里只顺手清掉轮询留下的提示）。
   */
  const check = useCallback(
    () =>
      act("check", async function () {
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
    const payload = await act("check", () => api.pluginUpdateCheck())
    if (!payload) return { failure: failureRef.current, note: "" }
    return sourceCheckOutcome(describePluginInstall(payload.status), payload.status.state === "error")
  }, [act])

  // 装最新那一版：与另外三条下载线同形（startDownload 归一结果 → finishDownload 按 kind 落地）。
  const install = useCallback(
    () =>
      act(
        "install",
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
