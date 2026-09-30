import { useEffect, useState } from "react"
import { ChevronRight, Download, Loader2, RefreshCw, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClampText } from "@/app/clamp-text"
import { BusyOverlay } from "@/app/busy-overlay"
import { Pager } from "@/app/pager"
import { Progress } from "@/components/ui/progress"
import { api, type UpdateStatus } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { pageSlice } from "@/lib/paging"
import { startUpdateDownload } from "@/lib/update-download"
import { switchVersionAndWait } from "@/lib/update-switch"
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
// 一页五版：一屏放得下，多出来的翻页。
const PAGE_SIZE = 5

/*
 * 客户端自身的版本：检查 → 下载 → 切换 → 回退。
 *
 * 版本是一张表：版本 / 状态 / 日期 / 说明 / 版本切换，每一行右边就是切到那一版的按钮；
 * 更新内容点开才看，一页五条，页面不长高。
 */
export function UpdateCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [probe, setProbe] = useState("")
  const [failure, setFailure] = useState("")
  const [working, setWorking] = useState("")
  const [page, setPage] = useState(1)
  const [openVersion, setOpenVersion] = useState("")
  // 正在切到哪一版：有值就铺遮罩、挡住一切操作。
  const [switching, setSwitching] = useState("")
  const [supervised, setSupervised] = useState(false)

  const transferring = status ? isDownloading(status.task) : false

  useEffect(() => {
    api
      .health()
      .then((payload) => setSupervised(payload.supervised))
      .catch(() => setSupervised(false))
  }, [])

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
      const got = await startUpdateDownload()
      if (got.status) setStatus(got.status)
      if (got.error) setFailure(got.error)
      else if (!got.started) toast.info(got.note)
    } finally {
      setWorking("")
    }
  }

  /*
   * 切版本：写指针 → 让这一份退出 → 等监督进程把新的拉起来 → 刷新页面。
   * 整个过程铺遮罩（用户点不了别处）；连不上的那几秒是预期的，不算失败。
   * 没有监督进程（直接 node server.js 起的）时退回老做法：下次启动生效。
   */
  async function switchTo(version: string) {
    setFailure("")
    if (!supervised) {
      await act("switch:" + version, () => api.updateApply(version), "已切到 v" + version + "，下次启动生效")
      return
    }
    setSwitching(version)
    let up = false
    try {
      // 写指针 → 退出 → 等新的一份起来：与顶上标注点一下切换走同一处。
      up = await switchVersionAndWait(version)
    } catch (error) {
      setSwitching("")
      setFailure(describeFailure(error))
      return
    }
    if (up) {
      window.location.reload()
      return
    }
    setSwitching("")
    setFailure("换版本没起来：关掉窗口重新双击一次 start.cmd，窗口里会写原因。")
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
  const frozen = Boolean(working) || busy

  return (
    <>
      {switching && <BusyOverlay text={"请稍等，正在切到 v" + switching} note="界面马上回来，不用你重启。" />}
      <Card className="flex flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>程序更新</CardTitle>
          <Badge variant={summary.tone}>{summary.label}</Badge>
          {status && <span className="text-muted-foreground text-xs">插件版本在「AI Agent」里管</span>}
        </div>
        <CardDescription>保持客户端最新，随时可以回到之前的版本。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">版本</span>
          <Pager page={page} total={rows.length} size={PAGE_SIZE} onPage={setPage} />
        </div>
        <VersionTable
          rows={shown}
          total={rows.length}
          openVersion={openVersion}
          frozen={frozen}
          status={status}
          onToggle={(version) => setOpenVersion(openVersion === version ? "" : version)}
          onSwitch={(row) => void switchTo(row.version)}
        />
      </CardContent>
    </Card>
    </>
  )
}

/* 一行的四列固定宽度，最后一列是切换按钮：点它就直接切到这一版。 */
const COL = {
  version: "w-16",
  state: "w-20",
  date: "w-24",
  action: "w-20"
}

function VersionTable(props: {
  rows: VersionRow[]
  total: number
  openVersion: string
  frozen: boolean
  status: UpdateStatus | null
  onToggle: (version: string) => void
  onSwitch: (row: VersionRow) => void
}) {
  if (props.total === 0) return <p className="text-muted-foreground text-xs">还没有版本记录。</p>
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="bg-muted/60 text-muted-foreground flex items-center gap-2 border-b px-2 py-1.5 text-xs">
        <span className="size-3.5 shrink-0" />
        <span className={COL.version}>版本</span>
        <span className={COL.state}>状态</span>
        <span className={COL.date}>日期</span>
        <span className="min-w-0 flex-1">说明</span>
        <span className={cn(COL.action, "text-right")}>版本切换</span>
      </div>
      {props.rows.map((row) => (
        <VersionLine
          key={row.version}
          row={row}
          open={props.openVersion === row.version}
          frozen={props.frozen}
          status={props.status}
          onToggle={() => props.onToggle(row.version)}
          onSwitch={() => props.onSwitch(row)}
        />
      ))}
    </div>
  )
}

function VersionLine(props: {
  row: VersionRow
  open: boolean
  frozen: boolean
  status: UpdateStatus | null
  onToggle: () => void
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
  const switchable = !row.current && row.installed && row.ready && canSwitch(props.status, row.version)

  return (
    <div className="border-b last:border-b-0">
      <div className="hover:bg-muted/40 flex items-center gap-2 px-2 py-1.5">
        {/* 展开是单独一颗按钮：行里还要放「切换」，按钮不能套按钮。 */}
        <button
          type="button"
          aria-expanded={props.open}
          aria-label={"展开 v" + row.version + " 的更新内容"}
          onClick={props.onToggle}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", props.open && "rotate-90")} />
        </button>
        <span className={cn(COL.version, "shrink-0 text-sm tabular-nums")}>v{row.version}</span>
        <span className={COL.state}>
          <Badge variant={badge.variant}>{badge.text}</Badge>
        </span>
        <span className={cn(COL.date, "text-muted-foreground shrink-0 text-xs")}>{row.date}</span>
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs" title={row.notes[0] ?? ""}>
          {row.notes[0] ?? "这一版没有留下说明"}
        </span>
        <span className={cn(COL.action, "flex shrink-0 justify-end")}>
          {switchable && (
            <Button size="sm" variant="outline" disabled={props.frozen} onClick={props.onSwitch}>
              <RotateCcw className="size-3" />
              切换
            </Button>
          )}
        </span>
      </div>
      {props.open && (
        <div className="px-8 pb-3">
          {row.notes.length > 0 ? (
            <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4 text-xs">
              {row.notes.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">这一版没有留下说明。</p>
          )}
        </div>
      )}
    </div>
  )
}
