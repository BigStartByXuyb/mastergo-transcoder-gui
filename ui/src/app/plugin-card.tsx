import { useEffect, useRef, useState } from "react"
import { Check, FolderSearch, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { PixelLoader } from "@/app/pixel-loader"
import { PluginSourceDialog } from "@/app/plugin-source-dialog"
import { useStatusPoll } from "@/app/use-status-poll"
import { finishDownload } from "@/app/download-actions"
import { api, type PluginSources, type PluginUpdateStatus } from "@/lib/api"
import { startDownload } from "@/lib/download-run"
import { describeFailure } from "@/lib/describe-failure"
import { describePluginInstall } from "@/lib/plugin-install"
import { pluginLookup, slotState, type PluginSourceRow, type PluginSourceSlot } from "@/lib/plugin-sources"
import { isTaskDone } from "@/lib/update-state"

// 插件：转码引擎来自 mastergo-wpf-transcoder 插件，客户端不自带引擎。
//
// 这一页只说三件事，各占一处，不重复：
//   找一个目录   —— 「我指定的那一份」（清掉＝回到按顺序自动）
//   按什么顺序找 —— 上面那条顺序，每一档都列出来（后端给的顺序，界面不重排）
//   每一档是什么 —— 一张表：来源 / 版本 / 状态 / 路径 / 操作；点开某一行是那一档的详情，
//                  点开「客户端自带」那一行是它的管理（检查更新 / 下载并安装 / 进度）。
export function PluginCard() {
  const [view, setView] = useState<PluginSources | null>(null)
  const [update, setUpdate] = useState<PluginUpdateStatus | null>(null)
  const [failure, setFailure] = useState("")
  const [probe, setProbe] = useState("")
  const [busy, setBusy] = useState("")
  const [opened, setOpened] = useState("")

  // 卸载之后迟到的响应不再落状态（首次读取与装完刷新走的是同一个 load）。
  const alive = useRef(true)

  // 读来源清单：首次进来读一次；装完插件、换过一份之后也要重读（表里那一行跟着变）。
  async function load() {
    try {
      const payload = await api.pluginSources()
      if (!alive.current) return
      setView(payload)
      setFailure("")
    } catch (error) {
      if (!alive.current) return
      setFailure(describeFailure(error))
    }
  }

  useEffect(() => {
    // StrictMode 下会「挂载 → 卸下 → 再挂载」：这里要重新放行，否则首次读取永远被拦掉。
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
  }, [])

  // 自带那一份的状态要一直跟着（表格里那一行要标「有新版」）：用与其它卡片同一条轮询，
  // 只有它在下的时候才快刷；装完那一下重读一次来源清单。
  const transferring = update ? update.task.phase === "downloading" || update.task.phase === "materializing" : false
  const lastPhase = useRef("")
  useStatusPoll({
    load: () => api.pluginUpdateStatus(),
    working: transferring,
    onData: (payload) => {
      const done = isTaskDone(payload.status.task) && lastPhase.current !== "done"
      lastPhase.current = payload.status.task.phase
      setUpdate(payload.status)
      setProbe("")
      if (done) void load()
    },
    onError: setProbe
  })

  // 换一份：空串＝回到「按顺序自动」；有任务在跑时后端会拒绝并说明原因。
  async function choose(path: string, key: string) {
    setBusy(key)
    setFailure("")
    try {
      setView(await api.pluginChoose(path))
      toast.success(path ? "已换用这一份插件" : "已改回按顺序自动找")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  async function pickFolder() {
    setBusy("pick")
    setFailure("")
    try {
      const picked = await api.pickFolder()
      if (picked.path) await choose(picked.path, "pick")
      else if (picked.reason) toast.info(picked.reason)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  // 自带那一份的两个动作：检查只拉清单，装是一条后台下载（进度与结果都在 update.task 里）。
  async function check() {
    setBusy("check")
    setFailure("")
    try {
      setUpdate((await api.pluginUpdateCheck()).status)
      setProbe("")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  async function install() {
    setBusy("install")
    setFailure("")
    try {
      const result = await startDownload(() => api.pluginUpdateInstall())
      if (result.status) setUpdate(result.status)
      finishDownload(result, {
        setFailure,
        onStarted: () =>
          toast.info(
            "开始装插件 v" + (result.status && result.status.available ? result.status.available.version : "")
          )
      })
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  const lookup = view ? pluginLookup(view.sources) : { slots: [], rows: [] }
  const selected = lookup.rows.find((row) => row.id === opened) ?? null

  return (
    <Card>
      <CardHeader>
        <CardTitle>插件</CardTitle>
        <CardDescription>
          转码引擎来自插件；下面这张表就是客户端找插件的顺序，用的是标「正在用」的那一份。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!view && !failure && <PixelLoader text="请稍等，正在查找插件" cell={3} className="py-4" />}

        {failure && (
          <Alert variant="destructive">
            <AlertTitle>出错了</AlertTitle>
            <AlertDescription>
              <ClampText text={failure} />
            </AlertDescription>
          </Alert>
        )}

        {view && view.plugin.failure && (
          <Alert variant="destructive">
            <AlertTitle>没找到插件</AlertTitle>
            <AlertDescription>
              <ClampText lines={5} text={view.plugin.failure} />
            </AlertDescription>
          </Alert>
        )}

        {view && (
          <>
            {/* 「我指定的那一份」只有这一处入口：换目录、或清掉回到按顺序自动。 */}
            <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
              <span className="text-sm font-medium">我指定的那一份</span>
              {view.chosen ? (
                <>
                  <Badge variant="secondary">正在用</Badge>
                  <IdentifierText className="text-muted-foreground min-w-0 flex-1 text-xs" text={view.chosen} />
                </>
              ) : (
                <span className="text-muted-foreground min-w-0 flex-1 text-xs">
                  没指定：客户端按下面的顺序自己找，现在用的是标「正在用」的那一条。
                </span>
              )}
              <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void pickFolder()}>
                {busy === "pick" ? <Loader2 className="size-4 animate-spin" /> : <FolderSearch className="size-4" />}
                指定一个目录…
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(busy) || !view.chosen}
                onClick={() => void choose("", "auto")}
              >
                {busy === "auto" && <Loader2 className="size-4 animate-spin" />}
                交给客户端找
              </Button>
            </div>

            {/* 查找顺序：每一档一句话，谁在生效、谁没有、哪两档是同一份，一眼看完。 */}
            <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
              {lookup.slots.map((slot, index) => (
                <span key={slot.id} className="flex items-center gap-1">
                  {index > 0 && <span className="text-muted-foreground">→</span>}
                  <button
                    type="button"
                    className="hover:bg-accent rounded-md border px-2 py-0.5 text-left"
                    title={slot.path}
                    onClick={() => setOpened(slot.mergedInto || slot.id)}
                  >
                    <span className="text-muted-foreground">{slot.order}.</span> {slot.label}
                    <SlotMark slot={slot} />
                  </button>
                </span>
              ))}
            </div>

            {/* 表：与顺序一一对应（同一份插件只列一行），点开某一行是那一档的详情 / 管理。 */}
            <div className="overflow-hidden rounded-md border">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[24%]">来源</TableHead>
                    <TableHead className="w-[14%]">版本</TableHead>
                    <TableHead className="w-[15%]">状态</TableHead>
                    <TableHead>路径</TableHead>
                    <TableHead className="w-[22%] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lookup.rows.map((row) => (
                    <PluginSourceLine
                      key={row.id}
                      row={row}
                      update={row.kind === "install" ? update : null}
                      busy={busy}
                      onOpen={() => setOpened(row.id)}
                      onChoose={() => void choose(row.pluginRoot, row.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* 轮询本身失败（读不到自带那份的状态）：说一句，别让它静默。 */}
            {probe && <span className="text-destructive text-xs">{probe}</span>}
          </>
        )}

        {selected && (
          <PluginSourceDialog
            row={selected}
            update={selected.kind === "install" ? update : null}
            busy={busy}
            onClose={() => setOpened("")}
            onChoose={(path, key) => void choose(path, key)}
            onCheck={() => void check()}
            onInstall={() => void install()}
          />
        )}
      </CardContent>
    </Card>
  )
}

// 顺序条上那一档的处境：正在用 / 有 / 没有 / 与某一档是同一份。
function SlotMark(props: { slot: PluginSourceSlot }) {
  const state = slotState(props.slot)
  if (state === "same") return <span className="text-muted-foreground">{`（与第 ${props.slot.mergedIntoOrder} 档同一份）`}</span>
  if (state === "active") return <span className="font-medium">（正在用）</span>
  if (state === "available") return <span className="text-muted-foreground">（有）</span>
  return <span className="text-muted-foreground">（没有）</span>
}

// 表里的一行：来源 / 版本 / 状态 / 路径 / 操作。
// 自带那一行还带一句它自己的更新状态（有新版 / 是最新 / 未检查 / 检查失败），表里就能看见要不要去管。
function PluginSourceLine(props: {
  row: PluginSourceRow
  update: PluginUpdateStatus | null
  busy: string
  onOpen: () => void
  onChoose: () => void
}) {
  const row = props.row
  const summary = props.update ? describePluginInstall(props.update) : null

  return (
    <TableRow className="cursor-pointer" onClick={props.onOpen}>
      <TableCell className="align-top text-sm whitespace-normal">
        <span className="block">
          <span className="text-muted-foreground">{row.order}.</span> <span>{row.label}</span>
        </span>
        {row.alsoFrom.length > 0 && (
          <span className="text-muted-foreground block text-xs">同时来自：{row.alsoFrom.join("、")}</span>
        )}
      </TableCell>
      <TableCell className="align-top text-xs whitespace-normal">
        {row.exists && row.version ? (
          <span className="font-mono">v{row.version}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        {row.active ? (
          <Badge variant="secondary">
            <Check className="size-3" />
            正在用
          </Badge>
        ) : row.exists ? (
          <Badge variant="outline">可用</Badge>
        ) : (
          <Badge variant="outline">没有</Badge>
        )}
        {summary && (
          <span className="block pt-1">
            <Badge variant={summary.tone}>{summary.label}</Badge>
          </span>
        )}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <IdentifierText className="text-muted-foreground text-xs" text={row.path} />
        {row.found.length > 1 && (
          <span className="text-muted-foreground block text-xs">这一处有 {row.found.length} 份，用最高版本</span>
        )}
      </TableCell>
      <TableCell className="align-top text-right whitespace-normal">
        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          {row.exists && !row.active && (
            <Button size="sm" variant="outline" disabled={Boolean(props.busy)} onClick={props.onChoose}>
              {props.busy === row.id && <Loader2 className="size-4 animate-spin" />}
              用这份
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={props.onOpen}>
            {row.kind === "install" ? "管理…" : "详情…"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
