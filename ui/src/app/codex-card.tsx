import { useEffect, useState } from "react"
import { Bot, Download, Loader2, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClampText } from "@/app/clamp-text"
import { Progress } from "@/components/ui/progress"
import { api, type CodexStatus } from "@/lib/api"
import { canDownload, canRollback, canSwitchTo, describeEngine, describeRelease, describeVersion } from "@/lib/codex-state"
import { finishDownload } from "@/app/download-actions"
import { startDownload } from "@/lib/download-run"
import { describeFailure } from "@/lib/describe-failure"
import { describeTask, isDownloading, taskPercent } from "@/lib/update-state"

const IDLE_POLL_MS = 15000
const WORKING_POLL_MS = 1000

/*
 * Codex 引擎：检查有没有新版 → 下载 → 自检 → 切版本 / 回退。
 * 默认用客户端自带那份，不碰用户本机装的。
 */
export function CodexCard() {
  const [status, setStatus] = useState<CodexStatus | null>(null)
  const [probe, setProbe] = useState("")
  const [failure, setFailure] = useState("")
  const [working, setWorking] = useState("")

  const transferring = status ? isDownloading(status.task) : false

  useEffect(() => {
    let stopped = false

    async function tick() {
      try {
        const payload = await api.codexStatus()
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

  async function act(key: string, run: () => Promise<{ status: CodexStatus }>, done = "") {
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

  async function download() {
    setWorking("download")
    setFailure("")
    const got = await startDownload(function () {
      return api.codexDownload()
    })
    finishDownload(got, { setStatus, setFailure })
    setWorking("")
  }

  const summary = describeEngine(status)
  const release = describeRelease(status)
  const taskText = status ? describeTask(status.task) : ""
  const busy = Boolean(status && status.busy)
  const downloadable = canDownload(status)
  const version = status?.release?.version ?? ""

  return (
    <Card>
      <CardHeader>
        <CardTitle>Codex 引擎</CardTitle>
        <CardDescription>「对话」与自动补输入用它跑模型，默认自带一份，与你本机装的互不影响。</CardDescription>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Badge variant={summary.tone}>
            <Bot className="size-3" />
            {summary.label}
          </Badge>
          {summary.note && <span className="text-muted-foreground text-xs">{summary.note}</span>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">{release}</p>
        <p className="text-muted-foreground text-xs">默认用 v{status?.pinned ?? ""}，独立存放，与你本机装的互不影响。</p>

        {transferring && status && (
          <div className="flex flex-col gap-2">
            <Progress value={taskPercent(status.task)} />
            <p className="text-muted-foreground text-xs">{taskText}</p>
          </div>
        )}

        {busy && (
          <Alert>
            <AlertTitle>有任务在跑</AlertTitle>
            <AlertDescription>{status?.busy}；跑完才能换版本。</AlertDescription>
          </Alert>
        )}

        {probe && (
          <Alert variant="destructive">
            <AlertTitle>读不到 Codex 状态</AlertTitle>
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

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={Boolean(working)} onClick={() => void act("check", () => api.codexCheck())}>
            {working === "check" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            检查版本
          </Button>
          {downloadable && (
            <Button disabled={Boolean(working)} onClick={() => void download()}>
              {working === "download" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              下载 v{version}
            </Button>
          )}
          {status && canSwitchTo(status, "") && (
            <Button
              variant="outline"
              disabled={Boolean(working)}
              onClick={() => void act("system", () => api.codexSwitch(""), "已切到本机那份 Codex")}
            >
              {working === "system" ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              用本机那份
            </Button>
          )}
          {status && canRollback(status) && (
            <Button
              variant="outline"
              disabled={Boolean(working)}
              onClick={() =>
                void act(
                  "rollback",
                  () => api.codexRollback(),
                  "已退到 v" + (status?.pointer?.previous ?? "") + "，下次对话生效"
                )
              }
            >
              {working === "rollback" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              退回 v{status?.pointer?.previous}
            </Button>
          )}
        </div>

        {status && status.versions.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">客户端下载过的版本</p>
            {status.versions.map((item) => (
              <div key={item.version} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-40 tabular-nums">{describeVersion(item)}</span>
                {item.active && <Badge variant="secondary">正在用</Badge>}
                {!item.active && !item.ready && <Badge variant="destructive">文件不全</Badge>}
                {!item.active && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(working) || !canSwitchTo(status, item.version)}
                    onClick={() =>
                      void act(
                        "switch:" + item.version,
                        () => api.codexSwitch(item.version),
                        "已切到 v" + item.version + "，下次对话生效"
                      )
                    }
                  >
                    切到这一版
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {status && status.system.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs">你本机装的（可选，不动它）</p>
            {status.system.map((item) => (
              <div key={item.path} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-40 tabular-nums">v{item.version}</span>
                {item.active && <Badge variant="secondary">正在用</Badge>}
                <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs" title={item.path}>
                  {item.path}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
