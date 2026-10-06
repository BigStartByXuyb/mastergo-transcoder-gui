import { useRef, useState } from "react"
import { Download, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { IdentifierText } from "@/app/identifier-text"
import { api, type PluginUpdateStatus } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { describePluginInstall, localSituation } from "@/lib/plugin-install"
import { describeTask, isDownloading, taskPercent } from "@/lib/update-state"
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
  const [working, setWorking] = useState("")

  const summary = describePluginInstall(status)
  const situation = localSituation(status, props.activeRoot)
  const transferring = status ? isDownloading(status.task) : false

  /*
   * 「装完了」只认一次：从「在下」变成「下完了」那一下才算（父组件据此重读来源表）。
   * onInstalled 放 ref 里：轮询的取数路径不跟着父组件的重渲染换闭包。
   */
  const onInstalled = useRef(props.onInstalled)
  onInstalled.current = props.onInstalled
  const wasTransferring = useRef(false)

  useStatusPoll({
    load: () => api.pluginUpdateStatus(),
    working: transferring,
    onData: (payload) => {
      const running = isDownloading(payload.status.task)
      if (wasTransferring.current && !running && payload.status.task.phase === "done") onInstalled.current()
      wasTransferring.current = running
      setStatus(payload.status)
      setFailure("")
    },
    onError: setFailure
  })

  async function act(key: string, run: () => Promise<{ status: PluginUpdateStatus }>, done: string) {
    setWorking(key)
    setFailure("")
    try {
      const payload = await run()
      setStatus(payload.status)
      if (done) toast.success(done)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setWorking("")
    }
  }

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
          disabled={Boolean(working) || transferring}
          onClick={() => void act("check", () => api.pluginUpdateCheck(), "")}
        >
          {working === "check" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          检查更新
        </Button>
        <Button
          size="sm"
          disabled={Boolean(working) || transferring || !summary.canInstall}
          onClick={() =>
            void act(
              "install",
              () => api.pluginUpdateInstall(),
              status && status.available ? "开始装插件 v" + status.available.version : "开始装插件"
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

      {!transferring && status && status.task.phase === "error" && (
        <span className="text-destructive text-xs">{status.task.error ? status.task.error.message : "装插件失败"}</span>
      )}

      <span className="text-muted-foreground text-xs">
        {situation === "none" &&
          "客户机上没有 Codex / Claude 时，用这里装一份客户端自己用的插件（装在下面「客户端自带」那一处）。"}
        {situation === "active" && "正在用的就是这一份。"}
        {situation === "other" &&
          "已装，但此刻用的不是这一份：下面表格里标「正在用」的那一行才是现在生效的；要换过来，点这一份那一行右边的「用这份」。"}
      </span>

      {summary.note && !transferring && <span className="text-muted-foreground text-xs">{summary.note}</span>}
      {failure && <span className="text-destructive text-xs">{failure}</span>}
    </div>
  )
}
