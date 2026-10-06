import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"

import { useStatusPoll } from "@/app/use-status-poll"
import { finishDownload } from "@/app/download-actions"
import { api, type PluginUpdateStatus } from "@/lib/api"
import { startDownload } from "@/lib/download-run"
import { describeFailure } from "@/lib/describe-failure"
import { isTaskDone } from "@/lib/update-state"

/*
 * 「客户端自带的那一份」这一半：它的状态要一直跟着（表格里那一行要标「有新版」），
 * 检查只拉清单、装是一条后台下载。装完那一下喊一声 onInstalled（父组件据此重读来源清单）。
 */

export function usePluginUpdate(onInstalled: () => void) {
  const [update, setUpdate] = useState<PluginUpdateStatus | null>(null)
  const [probe, setProbe] = useState("")
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState("")

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

  const check = useCallback(async function () {
    setBusy("check")
    setFailure("")
    try {
      setUpdate((await api.pluginUpdateCheck()).status)
      setProbe("")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }, [])

  const install = useCallback(async function () {
    setBusy("install")
    setFailure("")
    try {
      const result = await startDownload(() => api.pluginUpdateInstall())
      if (result.status) setUpdate(result.status)
      finishDownload(result, {
        setFailure,
        onStarted: () =>
          toast.info(
            "开始装插件 v" + (result.status && result.status.available ? result.status.available.version : "")
          )
      })
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }, [])

  return {
    update: update,
    transferring: transferring,
    probe: probe,
    failure: failure,
    busy: busy,
    check: check,
    install: install
  }
}
