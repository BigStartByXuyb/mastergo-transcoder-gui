import { useRef, useState } from "react"
import { Download, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { IdentifierText } from "@/app/identifier-text"
import { useActionRunner } from "@/app/use-action-runner"
import { api, type PluginUpdateStatus } from "@/lib/api"
import { startDownload } from "@/lib/download-run"
import { finishDownload } from "@/app/download-actions"
import { describePluginInstall, localSituation } from "@/lib/plugin-install"
import { describeTask, isDownloading, isTaskDone, taskFailureNote, taskPercent } from "@/lib/update-state"
import { useStatusPoll } from "@/app/use-status-poll"

/*
 * 客户端自带的那一份插件：检查 → 下载并安装。
 *
 * 客户机上没有 Codex / Claude 时，插件就只能由客户端自己装一份；装到安装根的
 * plugins\mastergo-wpf-transcoder\ 下，插件定位按最高版本取用。它在查找顺序里排最后：
 * 那两处有插件时用的还是它们那份，要用自带这份得点表格里那一行的「用这份」。
 * Codex / Claude 缓存里那几份归它们自己管，这里不碰。
 */
export function PluginInstallPanel(props: { activeRoot: string; onInstalled: () => void }) {
  const [status, setStatus] = useState<PluginUpdateStatus | null>(null)
  const [failure, setFailure] = useState("")
  // 轮询本身失败（读不到状态）与动作失败分开：与 update-card / codex-card 同一套通道划分。
  const [probe, setProbe] = useState("")
  const [working, setWorking] = useState("")

  const summary = describePluginInstall(status)
  const situation = localSituation(status, props.activeRoot)
  const transferring = status ? isDownloading(status.task) : false
  const taskFailure = status ? taskFailureNote(status.task) : ""
  const busy = status ? status.busy : ""

  /*
   * 「装完了」只认一次：阶段变成 done 那一下（父组件据此重读来源表）。
   * 不要求先看见「在下」——小插件可能在第一次轮询之前就装完了，那时也要刷新。
   * onInstalled 放 ref 里：轮询的取数路径不跟着父组件的重渲染换闭包。
   */
  const onInstalled = useRef(props.onInstalled)
  onInstalled.current = props.onInstalled
  const lastPhase = useRef("")

  useStatusPoll({
    load: () => api.pluginUpdateStatus(),
    working: transferring,
    onData: (payload) => {
      if (isTaskDone(payload.status.task) && lastPhase.current !== "done") onInstalled.current()
      lastPhase.current = payload.status.task.phase
      setStatus(payload.status)
      setProbe("")
    },
    onError: setProbe
  })

  // 动作骨架在 use-action-runner：与程序更新、Codex、运行时那三张卡同一套。
  const act = useActionRunner<PluginUpdateStatus>({ setWorking, setFailure, setStatus })

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">客户端自带的那一份</span>
        <Badge variant={summary.tone}>{summary.label}</Badge>
        {status && status.local.version && (
          <span className="text-muted-foreground text-xs">
            装在 <IdentifierText text={status.local.dir} className="text-xs" />
          </span>
        )}
        <span className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          disabled={Boolean(working) || transferring || Boolean(busy)}
          onClick={() => void act("check", () => api.pluginUpdateCheck(), "")}
        >
          {working === "check" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          检查更新
        </Button>
        <Button
          size="sm"
          disabled={Boolean(working) || transferring || Boolean(busy) || !summary.canInstall}
          onClick={() =>
            void act(
              "install",
              // 与另外三条下载线共用同一处归一：「起没起来」不再就地判一遍。
              () => startDownload(() => api.pluginUpdateInstall()),
              (payload) =>
                finishDownload(payload, {
                  setFailure,
                  onStarted: () =>
                    toast.info(
                      "开始装插件 v" + (payload.status && payload.status.available ? payload.status.available.version : "")
                    )
                })
            )
          }
        >
          {working === "install" || transferring ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {summary.action}
        </Button>
      </div>

      {/* 进度只在下的时候出现；旁边那一句说清下到哪儿了。 */}
      {transferring && status && (
        <div className="flex flex-col gap-1">
          <Progress value={taskPercent(status.task)} />
          <span className="text-muted-foreground text-xs">{describeTask(status.task)}</span>
        </div>
      )}

      {!transferring && taskFailure && <span className="text-destructive text-xs">{taskFailure}</span>}

      {/* 有任务在跑：后端会拒，界面先说清，按钮也已经禁掉。 */}
      {busy && <span className="text-muted-foreground text-xs">{"有任务在跑（" + busy + "），先等它跑完再装。"}</span>}

      <span className="text-muted-foreground text-xs">
        {situation === "none" &&
          "客户机上没有 Codex / Claude 时，用这里装一份客户端自己用的插件（装在下面「客户端自带」那一处）。"}
        {situation === "active" && "正在用的就是这一份。"}
        {situation === "other" &&
          "已装，但此刻用的不是这一份：下面表格里标「正在用」的那一行才是现在生效的；要换过来，点这一份那一行右边的「用这份」。"}
      </span>

      {summary.note && !transferring && <span className="text-muted-foreground text-xs">{summary.note}</span>}
      {failure && <span className="text-destructive text-xs">{failure}</span>}
      {probe && <span className="text-destructive text-xs">{probe}</span>}
    </div>
  )
}
