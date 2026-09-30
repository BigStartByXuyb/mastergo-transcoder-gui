import { useEffect, useState } from "react"
import { ChevronRight, Download, Loader2, RefreshCw, RotateCcw, Rocket } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClampText } from "@/app/clamp-text"
import { Pager } from "@/app/pager"
import { Progress } from "@/components/ui/progress"
import { api, type UpdateStatus } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { pageSlice } from "@/lib/paging"
import {
  blockedNote,
  canSwitch,
  describeTask,
  describeUpdate,
  isDownloading,
  taskPercent,
  versionList,
  type VersionRow
} from "@/lib/update-state"
import { cn } from "@/lib/utils"

const IDLE_POLL_MS = 15000
const WORKING_POLL_MS = 1500
// 一页五版：一屏放得下，多出来的翻页，不往下拖。
const PAGE_SIZE = 5

/*
 * 客户端自身的版本：检查 → 下载 → 切换 → 回退。
 *
 * 每一版收成一行（版本 / 状态 / 日期 / 一句简要），完整更新内容点开才看；
 * 版本多了一页五条，页面本身不长高。切换在下次启动生效，界面不复述这件事。
 */
export function UpdateCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [probe, setProbe] = useState("")
  const [failure, setFailure] = useState("")
  const [working, setWorking] = useState("")
  const [page, setPage] = useState(1)
  const [openVersion, setOpenVersion] = useState("")

  const transferring = status ? isDownloading(status.task) : false

  useEffect(() => {
    let stopped = false

    async function tick() {
      try {
        const payload = await api.updateStatus()
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

  async function act(key: string, run: () => Promise<{ status: UpdateStatus }>, done = "") {
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
    try {
      const payload = await api.updateDownload()
      setStatus(payload.status)
      if (!payload.started) toast.info(payload.note)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setWorking("")
    }
  }

  const summary = describeUpdate(status)
  const taskText = status ? describeTask(status.task) : ""
  const blocked = status ? blockedNote(status) : ""
  const busy = Boolean(status && status.busy)
  const rows = status ? versionList(status) : []
  const shown = pageSlice(rows, page, PAGE_SIZE)
  const canDownload = Boolean(
    status && status.state === "update_available" && status.available && !status.available.blocked && !working
  )

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>程序更新</CardTitle>
          <Badge variant={summary.tone}>{summary.label}</Badge>
          {status && <span className="text-muted-foreground text-xs">插件版本在「AI Agent」里管</span>}
        </div>
        <CardDescription>保持客户端最新，随时可以回到之前的版本。</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        {summary.note && <p className="text-muted-foreground text-sm">{summary.note}</p>}
        {blocked && <p className="text-sm">{blocked}</p>}

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
            <AlertTitle>读不到更新状态</AlertTitle>
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
          <Button variant="outline" disabled={Boolean(working)} onClick={() => void act("check", () => api.updateCheck())}>
            {working === "check" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            检查更新
          </Button>
          {canDownload && (
            <Button disabled={Boolean(working)} onClick={() => void download()}>
              {working === "download" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              下载 v{status?.available?.version}
            </Button>
          )}
          {status && status.ready && (
            <Button
              disabled={Boolean(working) || !canSwitch(status)}
              onClick={() => void act("apply", () => api.updateApply(), "已切到 v" + status.ready + "，下次启动生效")}
            >
              {working === "apply" ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
              切换到 v{status.ready}
            </Button>
          )}
          {status && status.rollback && (
            <Button
              variant="outline"
              disabled={Boolean(working) || busy}
              onClick={() =>
                void act("rollback", () => api.updateRollback(), "已退回 v" + (status?.rollback ?? "") + "，下次启动生效")
              }
            >
              {working === "rollback" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              回退到 v{status.rollback}
            </Button>
          )}
        </div>

        {/* 每版一行：点开才铺完整更新内容；一页五条，页面不长高。 */}
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">版本</span>
            <Pager page={page} total={rows.length} size={PAGE_SIZE} onPage={setPage} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col">
              {shown.map((row) => (
                <VersionLine
                  key={row.version}
                  row={row}
                  open={openVersion === row.version}
                  onToggle={() => setOpenVersion(openVersion === row.version ? "" : row.version)}
                  busy={Boolean(working) || busy}
                  status={status}
                  onSwitch={() =>
                    void act(
                      "switch:" + row.version,
                      () => api.updateApply(row.version),
                      "已切到 v" + row.version + "，下次启动生效"
                    )
                  }
                />
              ))}
              {rows.length === 0 && <p className="text-muted-foreground py-2 text-xs">还没有版本记录。</p>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* 一行 = 版本 + 状态 + 日期 + 一句简要；点开铺完整更新内容。 */
function VersionLine(props: {
  row: VersionRow
  open: boolean
  onToggle: () => void
  busy: boolean
  status: UpdateStatus | null
  onSwitch: () => void
}) {
  const row = props.row
  const badge = row.current
    ? { text: "正在用", variant: "secondary" as const }
    : row.ready
      ? { text: "可切换", variant: "outline" as const }
      : row.remote
        ? { text: "有新版", variant: "outline" as const }
        : row.installed
          ? { text: "文件不全", variant: "destructive" as const }
          : { text: "历史版本", variant: "outline" as const }

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={props.open}
        onClick={props.onToggle}
        className="hover:bg-muted/60 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors"
      >
        <ChevronRight className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", props.open && "rotate-90")} />
        <span className="w-16 shrink-0 text-sm tabular-nums">v{row.version}</span>
        <Badge variant={badge.variant} className="shrink-0">
          {badge.text}
        </Badge>
        <span className="text-muted-foreground w-24 shrink-0 text-xs">{row.date}</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={row.notes[0] ?? ""}>
          {row.notes[0] ?? "这一版没有留下说明"}
        </span>
      </button>
      {props.open && (
        <div className="flex flex-col gap-2 px-8 pb-3">
          {row.notes.length > 0 ? (
            <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4 text-xs">
              {row.notes.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">这一版没有留下说明。</p>
          )}
          {!row.current && row.installed && (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={props.busy || !canSwitch(props.status, row.version)}
              onClick={props.onSwitch}
            >
              切到这一版
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
