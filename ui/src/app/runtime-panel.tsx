/*
 * 运行时这一段（挂在「运行环境」页那张卡里）：跑插件的 Node.js 与 PowerShell 7 各钉死一份放进
 * 安装根的 runtime\<版本>\，默认只用我们自带的那一份（客户机上装了什么不该决定我们跑哪一版）；
 * 版本目录并存、指针指向生效那一版；claude 只检测。
 *
 * 一张表回答「现在用的是什么」：名称 / 版本（钉的与生效的）/ 来源（自带·系统）/ 操作；
 * 「来源」按钮开弹窗选那一份用哪个（自带的包从哪儿下也在那个弹窗里，见 runtime-source-dialog）。
 */
import { useState } from "react"
import { Download, Loader2, Terminal } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { Progress } from "@/components/ui/progress"
import { api, type RuntimeId, type RuntimeStatus, type RuntimeTool } from "@/lib/api"
import { finishDownload } from "@/app/download-actions"
import { startDownload } from "@/lib/download-run"
import { RuntimeSourceDialog } from "@/app/runtime-source-dialog"
import {
  describeRuntime,
  downloadLabel,
  downloadableId,
  isRuntimeWorking,
  runtimeTaskLine,
  runtimeTaskPercent,
  sourceLabel
} from "@/lib/runtime-state"
import { failureText } from "@/lib/describe-failure"
import { useStatusPoll } from "@/app/use-status-poll"
import { useActionRunner } from "@/app/use-action-runner"

export function RuntimePanel() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [probe, setProbe] = useState("")
  const [failure, setFailure] = useState("")
  const [working, setWorking] = useState("")
  // 正在改哪一份的来源（claude 没有来源可选）。
  const [editing, setEditing] = useState("")

  const transferring = status ? isRuntimeWorking(status.task) : false

  /*
   * 拉状态：轮询与「改完设置立刻刷新」都走这一条（`reload` 就是立刻取一次）。
   * 节拍、卸载守卫都在 useStatusPoll 里；运行时的包也是大件，刷新比别处勤一点。
   */
  const { reload: refresh } = useStatusPoll({
    load: () => api.runtimeStatus(),
    working: transferring,
    workingMs: 1000,
    onData: (payload) => {
      setStatus(payload.status)
      setProbe("")
    },
    onError: setProbe
  })

  // 下载也走同一条动作骨架（骨架在 use-action-runner）：状态由 act 套用，这里只按 kind 落地。
  const act = useActionRunner<RuntimeStatus>({ setWorking, setFailure, setStatus })

  async function download(tool: RuntimeId) {
    await act(
      tool,
      () => startDownload(() => api.runtimeDownload(tool)),
      (payload) => finishDownload(payload, { setFailure })
    )
  }

  const summary = describeRuntime(status)
  const busy = status ? status.busy : ""
  const tools = status ? status.tools : []
  const running = status ? tools.find((item) => item.id === status.task.tool) : undefined
  const taskLine = status ? runtimeTaskLine(status.task, running ? running.label : "") : ""
  const frozen = Boolean(working) || Boolean(busy) || transferring
  const editingTool = tools.find((tool) => tool.id === editing)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={summary.tone}>
          <Terminal className="size-3" />
          {summary.label}
        </Badge>
        {summary.note && <span className="text-muted-foreground text-xs">{summary.note}</span>}
      </div>

      {transferring && status && (
        <div className="flex flex-col gap-2">
          <Progress value={runtimeTaskPercent(status.task)} />
          <p className="text-muted-foreground text-xs">{taskLine}</p>
        </div>
      )}

      {busy && (
        <Alert>
          <AlertTitle>有任务在跑</AlertTitle>
          <AlertDescription>{busy}；跑完才能换运行时。</AlertDescription>
        </Alert>
      )}

      {probe && (
        <Alert variant="destructive">
          <AlertTitle>读不到运行时状态</AlertTitle>
          <AlertDescription>
            <ClampText text={probe} />
          </AlertDescription>
        </Alert>
      )}

      {failure && (
        <Alert variant="destructive">
          <AlertTitle>出错了</AlertTitle>
          <AlertDescription>
            <ClampText text={failure} />
          </AlertDescription>
        </Alert>
      )}

      {status && status.error && (
        <Alert variant="destructive">
          <AlertTitle>上一次没装成</AlertTitle>
          <AlertDescription>
            <ClampText text={failureText(status.error)} />
          </AlertDescription>
        </Alert>
      )}

      {tools.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground text-xs">
              <th className="pb-1 text-left font-normal">名称</th>
              <th className="pb-1 pl-2 text-left font-normal">版本</th>
              <th className="pb-1 pl-2 text-left font-normal">来源</th>
              <th className="pb-1 pl-2 text-right font-normal">操作</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <RuntimeRow
                key={tool.id}
                tool={tool}
                id={downloadableId(status, tool)}
                working={working === tool.id}
                frozen={frozen}
                onDownload={download}
                onEditSource={() => setEditing(tool.id)}
              />
            ))}
          </tbody>
        </table>
      )}

      {editingTool && (
        <RuntimeSourceDialog
          tool={editingTool}
          mirror={status ? status.mirror : ""}
          working={working === editingTool.id}
          /* 「给不给下载按钮」只有一处判据（可点性跟着任务状态走），弹窗别再自己算一套。 */
          downloadable={downloadableId(status, editingTool)}
          onDownload={download}
          onClose={() => setEditing("")}
          onSaved={refresh}
        />
      )}
    </div>
  )
}

/* 表格一行：名称（下面挂路径与装过的版本）/ 版本（钉的与生效的）/ 来源 / 操作。 */
function RuntimeRow({
  tool,
  id,
  working,
  frozen,
  onDownload,
  onEditSource
}: {
  tool: RuntimeTool
  id: RuntimeId | ""
  working: boolean
  frozen: boolean
  onDownload: (tool: RuntimeId) => void
  onEditSource: () => void
}) {
  return (
    <tr className="border-t align-top">
      <td className="py-2 pr-2">
        <div>{tool.label}</div>
        <IdentifierText className="text-muted-foreground text-xs" text={tool.path} />
        {tool.versions.length > 1 && (
          <p className="text-muted-foreground text-xs">
            本机装过：{tool.versions.map((version) => (version === tool.active ? version + "（当前）" : version)).join("、")}
          </p>
        )}
      </td>
      <td className="py-2 pl-2">
        <div>{tool.pinned ? "钉 v" + tool.pinned : "只检测"}</div>
        <div className="text-muted-foreground text-xs">{tool.version ? "v" + tool.version : "—"}</div>
      </td>
      <td className="py-2 pl-2">
        <SourceBadge tool={tool} />
        {tool.note && <ClampText className="text-muted-foreground text-xs" lines={2} text={tool.note} />}
      </td>
      <td className="py-2 pl-2 text-right">
        <div className="flex flex-wrap justify-end gap-2">
          {tool.id !== "claude" && (
            <Button size="sm" variant="outline" disabled={frozen} onClick={onEditSource}>
              来源
            </Button>
          )}
          {id && (
            <Button size="sm" variant="outline" disabled={working || frozen} onClick={() => onDownload(id)}>
              {working ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {downloadLabel(tool)}
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

function SourceBadge({ tool }: { tool: RuntimeTool }) {
  const label = sourceLabel(tool)
  const variant = tool.ready ? "secondary" : (tool.installed ? "destructive" : "outline")
  return <Badge variant={variant}>{label}</Badge>
}
