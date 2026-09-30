import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { BusyOverlay } from "@/app/busy-overlay"
import { ConfirmSwitchDialog } from "@/app/confirm-switch-dialog"
import type { UpdateHint } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { startUpdateDownload } from "@/lib/update-download"
import { switchVersionAndWait } from "@/lib/update-switch"

/*
 * 顶上的新版标注：后台每 10 分钟查一次，查到新版就在这儿挂个红点。
 * 点它：还没下载就先开始下载（后台跑，进度在设置页看），已经下载好就直接切过去 —— 切完界面自己回来。
 */

export function UpdateBadge(props: { update: UpdateHint | undefined; supervised: boolean; onOpenUpdatePage: () => void }) {
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const [confirming, setConfirming] = useState(false)
  const hint = props.update
  const target = hint ? hint.ready || hint.availableVersion : ""

  if (!hint || !target || hint.state === "up_to_date" || hint.state === "error") return null

  const downloaded = hint.state === "download_ready"

  async function open() {
    if (!hint) return
    setFailure("")
    // 还没下载：先开始下载（后台任务），并把人带到更新页看进度。
    if (!downloaded) {
      setBusy("download")
      const got = await startUpdateDownload(target)
      setBusy("")
      if (got.error || !got.started) {
        // 没起来就留在原地把原因说清，不再把人带走。
        setFailure(got.error || got.note || "这次没开始下载")
        return
      }
      props.onOpenUpdatePage()
      return
    }
    // 已经下载好：确认过再切过去，不用再去设置页点一遍。
    if (!props.supervised) {
      props.onOpenUpdatePage()
      return
    }
    // 这条入口只可能是升级（红点只在有更新版时出现），所以不用列「回退会缺什么」。
    setConfirming(true)
  }

  async function confirmSwitch() {
    setConfirming(false)
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
      {confirming && (
        <ConfirmSwitchDialog
          target={target}
          current={hint ? hint.current : ""}
          freshRunRequired={hint ? hint.stagedFreshRunRequired : null}
          busy=""
          onCancel={() => setConfirming(false)}
          onConfirm={() => void confirmSwitch()}
        />
      )}
    </>
  )
}
