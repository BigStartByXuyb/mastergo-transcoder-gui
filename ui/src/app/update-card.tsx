import { useCallback, useEffect, useState } from "react"
import { ChevronRight, Download, Loader2, RefreshCw, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClampText } from "@/app/clamp-text"
import { ConfirmSwitchDialog } from "@/app/confirm-switch-dialog"
import { BusyOverlay } from "@/app/busy-overlay"
import { Pager } from "@/app/pager"
import { Progress } from "@/components/ui/progress"
import { SourceDialog } from "@/app/source-dialog"
import { UpdateSourceRow } from "@/app/update-source-row"
import { api, type UpdateStatus } from "@/lib/api"
import { pageSlice } from "@/lib/paging"
import { finishDownload } from "@/app/download-actions"
import { useActionRunner } from "@/app/use-action-runner"
import { useFailureMemory } from "@/app/use-failure-memory"
import { useStatusPoll } from "@/app/use-status-poll"
import { startUpdateDownload } from "@/lib/update-download"
import { runSwitch } from "@/lib/update-switch"
import { missingFeatures } from "@/lib/version-features"
import { sourceCheckOutcomeOf } from "@/lib/source-check"
import {
  blockedNote,
  busyNow,
  UPDATE_BUSY,
  canSwitch,
  describeTask,
  describeUpdate,
  isDownloading,
  taskPercent,
  versionList,
  type VersionRow
} from "@/lib/update-state"
import { cn } from "@/lib/utils"

// 一页五版：一屏放得下，多出来的翻页。
const PAGE_SIZE = 5

/*
 * 客户端自身的版本：检查 → 下载 → 切换 → 回退。
 *
 * 「从哪儿取」也在这张卡里：更新来源那一行显示现在的源，点「修改发布源」开弹窗改 ——
 * 检查更新与下载都走它，两件事本来就是一体的。
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
  // 等着人确认的那一版：确认弹窗里会先把回退 / 新开运行 / 有任务在跑说清楚。
  const [confirming, setConfirming] = useState("")
  const [supervised, setSupervised] = useState(false)
  // 改发布源的弹窗：更新从哪儿取。
  const [editingSource, setEditingSource] = useState(false)

  const transferring = status ? isDownloading(status.task) : false

  useEffect(() => {
    api
      .health()
      .then((payload) => setSupervised(payload.supervised))
      .catch(() => setSupervised(false))
  }, [])

  // 取数只有这一跳（轮询与「改完发布源立刻重读」都走它）：落地与清提示都在 onData 一处做。
  const { reload } = useStatusPoll({
    load: () => api.updateStatus(),
    working: transferring,
    onData: (payload) => {
      setStatus(payload.status)
      setProbe("")
    },
    onError: setProbe
  })

  /*
   * 页面上的每个动作都走这一条（骨架在 use-action-runner）：「怎么提示」由调用方给 ——
   * 有的要按结果（DownloadOutcome 的 kind/message）才决定说什么。
   */
  // 失败原话的记忆在 app/use-failure-memory（两半共用），动作骨架照旧写状态。
  const failureMemory = useFailureMemory(setFailure)
  const act = useActionRunner<UpdateStatus>({ setWorking, setFailure: failureMemory.remember, setStatus })

  /*
   * 「检查更新」只有这一个入口：卡片上那颗按钮与「修改发布源」里的「保存并检查」都调它。
   * 它走这张卡的动作骨架（忙碌位与别处一致），返回弹窗要的那两句话（卡片那颗不看返回值）；
   * 「怎么说」归 describeUpdate 一处，没拿到结果时用刚才记住的那句原话。
   */
  const runCheck = useCallback(
    async function () {
      const payload = await act(UPDATE_BUSY.check, () => api.updateCheck())
      return sourceCheckOutcomeOf(payload, failureMemory.last(), describeUpdate, (next) => next.state === "error")
    },
    [act, failureMemory]
  )
  /*
   * 忙不忙：三路忙位（这条线的动作 / 正在传 / 后端任务）摆给同一处判据 busyNow，与插件那一半同一套。
   * 这一颗值同时管三件事：能不能点「检查更新」、版本表的切换/下载、发布源能不能改。
   */
  const frozen = busyNow([{ busy: working, transferring }, { busy: status ? status.busy : "" }])
  const canCheck = Boolean(status) && !frozen

  /*
   * 下某一版（含历史版本）：清单按那一版的 tag 取，之后同一条下载流程。
   * 下完这一行就从「历史版本」变成「可切换」。
   */
  async function stage(version: string) {
    await act(
      UPDATE_BUSY.stage(version),
      // 与顶栏红点共用同一处「发起下载」。
      () => startUpdateDownload(version),
      (payload) =>
        // act 已经套过状态，这里只按 kind 落地（失败写红字、起步报一句）。
        finishDownload(payload, {
          // 下载失败的原话也走同一处记忆（与插件那一半同形）：弹窗那边要的是同一句。
          setFailure: failureMemory.remember,
          onStarted: () => toast.success("正在下载 v" + version)
        })
    )
  }

  /*
   * 切版本：写指针 → 让这一份退出 → 等监督进程把新的拉起来 → 刷新页面。
   * 整个过程铺遮罩（用户点不了别处）；连不上的那几秒是预期的，不算失败。
   * 没有监督进程（直接 node server.js 起的）时退回老做法：下次启动生效。
   */
  async function switchTo(version: string) {
    setFailure("")
    if (!supervised) {
      await act(UPDATE_BUSY.switch(version), () => api.updateApply(version), "已切到 v" + version + "，下次启动生效")
      return
    }
    setSwitching(version)
    // 写指针 → 退出 → 等新的一份起来：与顶上标注点一下切换共用同一处编排。
    const outcome = await runSwitch(version)
    if (outcome.ok) {
      window.location.reload()
      return
    }
    setSwitching("")
    setFailure(outcome.note)
  }

  const summary = describeUpdate(status)
  const taskText = status ? describeTask(status.task) : ""
  const blocked = status ? blockedNote(status) : ""
  const busy = Boolean(status && status.busy)
  const rows = status ? versionList(status) : []
  const shown = pageSlice(rows, page, PAGE_SIZE)

  return (
    <>
      {switching && <BusyOverlay text={"请稍等，正在切到 v" + switching} note="界面马上回来，不用你重启。" />}
      <Card className="flex flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>程序更新</CardTitle>
          <Badge variant={summary.tone}>{summary.label}</Badge>
          {status && <span className="text-muted-foreground text-xs">插件（流水线）版本在本页上一行切过去管</span>}
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

        {status && (
          <UpdateSourceRow
            source={status.source}
            hasToken={status.hasToken}
            disabled={frozen}
            onEdit={() => setEditingSource(true)}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={!canCheck}
            aria-busy={working === UPDATE_BUSY.check}
            onClick={() => void runCheck()}
          >
            {working === UPDATE_BUSY.check ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            检查更新
          </Button>
          {/* 下载只有一个入口：版本表里那一行的「下载」——有新版时就是最上面那一行。 */}
          <span className="text-muted-foreground text-xs">要下哪一版，点那一行的「下载」</span>
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
          onSwitch={(row) => setConfirming(row.version)}
          onStage={(row) => void stage(row.version)}
        />
      </CardContent>
    </Card>

      {editingSource && status && (
        <SourceDialog
          subject="程序更新"
          view={{ source: status.source, hasToken: status.hasToken }}
          onClose={() => setEditingSource(false)}
          reload={async () => {
            const payload = await reload()
            if (!payload) throw new Error("读不到更新状态")
            return { source: payload.status.source, hasToken: payload.status.hasToken }
          }}
          check={runCheck}
        />
      )}

      {confirming && (
        <ConfirmSwitchDialog
          target={confirming}
          current={status ? status.current : ""}
          freshRunRequired={freshRunRequiredOf(status, confirming)}
          busy={busy && status ? status.busy : ""}
          missing={
            status
              ? missingFeatures(status.history, confirming, status.current).map((feature) => feature.label)
              : []
          }
          onCancel={() => setConfirming("")}
          onConfirm={() => {
            const version = confirming
            setConfirming("")
            void switchTo(version)
          }}
        />
      )}
    </>
  )
}

/** 目标那一版要不要新开一次运行：本机有它的清单就按清单说，没有就说不知道。 */
function freshRunRequiredOf(status: UpdateStatus | null, version: string): boolean | null {
  if (!status) return null
  if (status.available && status.available.version === version) return status.available.freshRunRequired
  const staged = status.staged.find((item) => item.version === version)
  return staged && typeof staged.freshRunRequired === "boolean" ? staged.freshRunRequired : null
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
  onStage: (row: VersionRow) => void
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
        <span className={cn(COL.action, "text-right")}>操作</span>
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
          onStage={() => props.onStage(row)}
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
  onStage: () => void
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
          {/* 本机没有这一份（或那份不完整）、也不是正在跑的那一版：下回来，下完就能切。 */}
          {!switchable && !row.current && (!row.installed || !row.ready) && (
            <Button
              size="sm"
              variant="ghost"
              disabled={props.frozen}
              title={
                row.installed
                  ? "本机这一份不完整，重新下回来（下完就能切过去）"
                  : "把 v" + row.version + " 下载到本机（下完就能切过去）"
              }
              onClick={props.onStage}
            >
              <Download className="size-3" />
              {row.installed ? "重下" : "下载"}
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
