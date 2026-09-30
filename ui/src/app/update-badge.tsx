import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { BusyOverlay } from "@/app/busy-overlay"
import { api, type UpdateHint } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { switchVersionAndWait } from "@/lib/update-switch"

/*
 * 顶上的新版标注：后台每 10 分钟查一次，查到新版就在这儿挂个红点。
 * 点它：还没下载就先开始下载（后台跑，进度在设置页看），已经下载好就直接切过去 —— 切完界面自己回来。
 */

export function UpdateBadge(props: { update: UpdateHint | null; supervised: boolean; onOpenUpdatePage: () => void }) {
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const hint = props.update
  const target = hint && hint.ready ? hint.ready : hint ? hint.availableVersion : ""

  if (!hint || !target || hint.state === "up_to_date" || hint.state === "error") return null

  const downloaded = hint.state === "download_ready" && hint.ready === target

  async function open() {
    if (!hint) return
    setFailure("")
    // 还没下载：先开始下载（后台任务），并把人带到更新页看进度。
    if (!downloaded) {
      setBusy("download")
      try {
        const started = await api.updateDownload()
        if (!started.started) setFailure(started.note || "这次没开始下载")
      } catch (error) {
        setFailure(describeFailure(error))
      } finally {
        setBusy("")
      }
      props.onOpenUpdatePage()
      return
    }
    // 已经下载好：直接切过去，不用再去设置页点一遍。
    if (!props.supervised) {
      props.onOpenUpdatePage()
      return
    }
    setBusy("switch")
    try {
      const up = await switchVersionAndWait(target)
      if (up) {
        window.location.reload()
        return
      }
      setBusy("")
      setFailure("换版本没起来：打开设置里的「更新」看原因。")
      props.onOpenUpdatePage()
    } catch (error) {
      setBusy("")
      setFailure(describeFailure(error))
    }
  }

  return (
    <>
      {busy === "switch" && <BusyOverlay text={"请稍等，正在切到 v" + target} note="界面马上回来，不用你重启。" />}
      <button
        type="button"
        className="shrink-0"
        title={downloaded ? "点一下切到 v" + target + "（切完界面自己回来）" : "点一下开始下载 v" + target}
        onClick={() => void open()}
      >
        <Badge variant="destructive" className="gap-1.5">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-white" />}
          {downloaded ? "可切到 v" + target : "有新版 v" + target}
        </Badge>
      </button>
      {failure && <span className="text-destructive text-xs">{failure}</span>}
    </>
  )
}
