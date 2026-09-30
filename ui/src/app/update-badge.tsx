import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { BusyOverlay } from "@/app/busy-overlay"
import { ConfirmSwitchDialog } from "@/app/confirm-switch-dialog"
import type { UpdateHint } from "@/lib/api"
import { startUpdateDownload } from "@/lib/update-download"
import { runSwitch } from "@/lib/update-switch"

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
      if (got.kind === "failed") {
        // 没起来就留在原地把原因说清，不再把人带走。
        setFailure(got.message)
        return
      }
      // 本机已经有这一版（状态过期一类的竞争）：带去更新页，那行会显示「切换」。
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
    const outcome = await runSwitch(target)
    if (outcome.ok) {
      window.location.reload()
      return
    }
    setBusy("")
    setFailure(outcome.note)
    // 没起来就带人去更新页看原因（这条入口的展示差异，编排与设置页那一处相同）。
    props.onOpenUpdatePage()
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
          current={hint.current}
          freshRunRequired={hint.stagedFreshRunRequired}
          busy={hint.busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void confirmSwitch()}
        />
      )}
    </>
  )
}
