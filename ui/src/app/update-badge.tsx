import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { BusyOverlay } from "@/app/busy-overlay"
import { ConfirmSwitchDialog } from "@/app/confirm-switch-dialog"
import type { UpdateHint } from "@/lib/api"
import { finishDownload } from "@/app/download-actions"
import { targetVersion } from "@/lib/update-state"
import { startUpdateDownload } from "@/lib/update-download"
import { runSwitch } from "@/lib/update-switch"

/*
 * 顶上的新版标注：后台按 lib/recheck.js 的节拍复查，查到新版就在这儿挂个红点。
 * 点它：还没下载就先开始下载（后台跑，进度在设置页看），已经下载好就直接切过去 —— 切完界面自己回来。
 */

export function UpdateBadge(props: { update: UpdateHint | undefined; supervised: boolean; onOpenUpdatePage: () => void }) {
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const [confirming, setConfirming] = useState(false)
  const hint = props.update
  /*
   * 目标版 = 远端说的那一版与本地已下好可切的那一版里更新的那个（判据在 lib/update-state.ts）。
   * 「下没下好」必须问**这一个版本**自己 —— 以前问的是全局状态（只要有任意一版下好了就算「已下载」），
   * 于是没下过的远端新版会被当成「可切」，点下去切的是另一版，或者干脆被后端拒（和清单对不上）。
   */
  const target = hint ? targetVersion(hint) : ""

  /*
   * 状态一变（下载好、切成新版）就把上一次那句收掉：它说的是上一刻的事，留着会让人以为现在还坏着
   * —— 实测过的样子：下载其实已经好了，红字还挂在旁边。
   */
  useEffect(
    function () {
      setFailure("")
    },
    [hint ? hint.state : "", hint ? hint.ready : "", hint ? hint.availableVersion : ""]
  )

  if (!hint || !target || hint.state === "up_to_date" || hint.state === "error") return null

  const downloaded = hint.ready === target

  async function open() {
    if (!hint) return
    setFailure("")
    // 还没下载：先开始下载（后台任务），并把人带到更新页看进度。
    if (!downloaded) {
      setBusy("download")
      const got = await startUpdateDownload(target)
      setBusy("")
      // 这条入口没有自己的状态可套：起来了或本来就有，都带去更新页；失败留在原地把原因说清。
      finishDownload(got, {
        setFailure,
        // 起来了或本来就有，都把人带到更新页；「已经在下载了」（busy）按同一处兜底也走这一条。
        onStarted: props.onOpenUpdatePage,
        onAlready: props.onOpenUpdatePage
      })
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
    // 后端还在（被拒）才带人去更新页看原因；它已经没了的时候，带过去只是一页载不出来。
    if (outcome.serviceUp) props.onOpenUpdatePage()
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
