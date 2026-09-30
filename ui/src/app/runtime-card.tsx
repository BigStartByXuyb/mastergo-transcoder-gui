import { useEffect, useState } from "react"
import { Download, Loader2, Terminal } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { Progress } from "@/components/ui/progress"
import { api, type RuntimeId, type RuntimeStatus, type RuntimeTool } from "@/lib/api"
import { applyDownload, startDownload } from "@/lib/download-run"
import {
  describeRuntime,
  describeTool,
  downloadLabel,
  downloadableId,
  isRuntimeWorking,
  runtimeTaskLine,
  runtimeTaskPercent
} from "@/lib/runtime-state"
import { describeFailure } from "@/lib/describe-failure"

const IDLE_POLL_MS = 15000
const WORKING_POLL_MS = 1000

/*
 * 运行时：跑插件的 Node.js 与 PowerShell 7 各钉死一份放进安装根的 runtime\，不用系统上那一份。
 * 坏了只能重下修好（这两份在关键路径上，不提供版本切换）；claude 只检测。
 */
export function RuntimeCard() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [probe, setProbe] = useState("")
  const [failure, setFailure] = useState("")
  const [working, setWorking] = useState("")

  const transferring = status ? isRuntimeWorking(status.task) : false

  useEffect(() => {
    let stopped = false

    async function tick() {
      try {
        const payload = await api.runtimeStatus()
        if (stopped) return
        setStatus(payload.status)
        setProbe("")
      } catch (error) {
        if (stopped) return
        setProbe(describeFailure(error))
      }
    }

    void tick()
    const timer = window.setInterval(tick, transferring ? WORKING_POLL_MS : IDLE_POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [transferring])

  async function download(tool: RuntimeId) {
    setWorking(tool)
    setFailure("")
    const got = await startDownload(function () {
      return api.runtimeDownload(tool)
    })
    if (got.status) setStatus(got.status)
    applyDownload(got, { setFailure, onAlready: (message) => toast.info(message) })
    setWorking("")
  }

  const summary = describeRuntime(status)
  const busy = status ? status.busy : ""
  const tools = status ? status.tools : []
  const running = status ? tools.find((item) => item.id === status.task.tool) : undefined
  const taskLine = status ? runtimeTaskLine(status.task, running ? running.label : "") : ""

  return (
    <Card>
      <CardHeader>
        <CardTitle>运行时</CardTitle>
        <CardDescription>转码需要的运行组件，随客户端一起提供，不用另外安装。</CardDescription>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Badge variant={summary.tone}>
            <Terminal className="size-3" />
            {summary.label}
          </Badge>
          {summary.note && <span className="text-muted-foreground text-xs">{summary.note}</span>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
              <ClampText text={status.error.message + (status.error.hint ? "。" + status.error.hint : "")} />
            </AlertDescription>
          </Alert>
        )}

        {tools.map((tool) => (
          <RuntimeRow
            key={tool.id}
            tool={tool}
            id={downloadableId(status, tool)}
            working={working === tool.id}
            onDownload={download}
          />
        ))}
      </CardContent>
    </Card>
  )
}

/* 一行：名字、钉死的那一版、现在用的是哪份、有问题才给按钮。 */
function RuntimeRow({
  tool,
  id,
  working,
  onDownload
}: {
  tool: RuntimeTool
  id: RuntimeId | ""
  working: boolean
  onDownload: (tool: RuntimeId) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-28 text-sm">{tool.label}</span>
        {tool.pinned ? <Badge variant="secondary">钉 v{tool.pinned}</Badge> : <Badge variant="outline">只检测</Badge>}
        <span className={tool.ready ? "text-sm" : "text-destructive text-sm"}>{describeTool(tool)}</span>
        {id && (
          <Button size="sm" variant="outline" disabled={working} onClick={() => onDownload(id)}>
            {working ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {downloadLabel(tool)}
          </Button>
        )}
      </div>
      {tool.note && (
        <ClampText className="text-muted-foreground text-xs" lines={2} text={tool.note} />
      )}
      <IdentifierText className="text-muted-foreground text-xs" text={tool.path} />
    </div>
  )
}
