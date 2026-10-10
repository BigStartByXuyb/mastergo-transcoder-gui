import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"

import { PendingPanel } from "@/app/pending-panel"
import { LayoutPanel } from "@/app/layout-panel"
import { ClampText } from "@/app/clamp-text"
import { PixelLoader } from "@/app/pixel-loader"
import { IdentifierText } from "@/app/identifier-text"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, type PendingQueueEntry } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { REVIEW_POLL_MS } from "@/lib/task-state"

/*
 * 待确认页：列出**所有**还缺语义输入的页面。
 *
 * 列表来自后端 /api/pending/list —— 看板任务（一条一个工作目录）和流水线页直跑的运行都在里面，
 * 按「工程目录 + Target」去重。这里只负责选一条、把面板挂上去；判断什么要填仍然由插件产物决定。
 */

const RUN_STATE_TEXT: Record<string, string> = {
  queued: "排队中",
  preparing: "建工作目录",
  running: "运行中",
  waiting: "待确认",
  ready: "待合并",
  merging: "合并中",
  merged: "已合并",
  conflict: "合并冲突",
  failed: "失败",
  stopped: "已停止",
  done: "已跑完",
  stopping: "正在停止"
}

function keyOf(entry: { source: string; projectRoot: string; target: string }) {
  return entry.source + "|" + entry.projectRoot + "|" + entry.target
}

export function ReviewPage() {
  const [queue, setQueue] = useState<PendingQueueEntry[]>([])
  const [problem, setProblem] = useState("")
  const [selected, setSelected] = useState("")
  const [automation, setAutomation] = useState("assist")
  const [manualRoot, setManualRoot] = useState("")
  const [manualTarget, setManualTarget] = useState("")
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const payload = await api.pendingList()
      setQueue(payload.queue.items)
      setProblem("")
    } catch (error) {
      setProblem(describeFailure(error))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), REVIEW_POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    api
      .settingsGet()
      .then((payload) => setAutomation(payload.settings.automation))
      .catch(() => undefined)
  }, [])

  // 选中的那条已经从列表里消失（填完了 / 任务被移除），面板继续留着看结果，但会提示一下。
  const active = useMemo(() => {
    const hit = queue.find((item) => keyOf(item) === selected)
    if (hit) return hit
    if (manualRoot.trim() && manualTarget.trim()) {
      return {
        source: "pipeline" as const,
        projectRoot: manualRoot.trim(),
        target: manualTarget.trim(),
        runId: "",
        taskId: "",
        runState: "",
        counts: { icons: 0, translations: 0, layout: 0 },
        total: 0
      }
    }
    return null
  }, [queue, selected, manualRoot, manualTarget])

  return (
    <div className="flex w-full flex-col gap-4">
      {problem && (
        <Alert variant="destructive">
          <AlertTitle>待确认列表没读到最新状态</AlertTitle>
              <AlertDescription>
                <ClampText text={problem} />
              </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>待确认</CardTitle>
          <CardDescription>
            流水线停在语义判断点时要人/AI 补的输入。看板里的任务与流水线页直跑的运行都列在这里，
            按「工程目录 + 页面 Target」去重；填完就从列表里消失。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={queue.length > 0 ? "default" : "outline"}>待填 {queue.length} 条</Badge>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="size-4" />
              刷新
            </Button>
          </div>

          <div className="overflow-hidden rounded-md border">
            {/* 列宽按比例给：中间内容再长也只换行或截断，不把整张表撑出容器。 */}
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[11%] whitespace-normal">来源</TableHead>
                  <TableHead className="w-[15%]">Target</TableHead>
                  <TableHead className="w-[10%] whitespace-normal">运行状态</TableHead>
                  <TableHead className="w-[12%] whitespace-normal">待填</TableHead>
                  <TableHead>工程 / 工作目录</TableHead>
                  <TableHead className="w-[10%] text-right whitespace-normal">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((entry) => {
                  const key = keyOf(entry)
                  const isActive = key === selected
                  return (
                    <TableRow key={key} className={isActive ? "bg-muted/50" : undefined}>
                      <TableCell className="align-top whitespace-normal">
                        <Badge variant={entry.source === "board" ? "secondary" : "outline"}>
                          {entry.source === "board" ? "看板" : "流水线"}
                        </Badge>
                        {entry.orphan && (
                          <Badge variant="outline" className="ml-1">
                            任务已移除
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs break-all">
                        {entry.target || "（未指定）"}
                      </TableCell>
                      <TableCell className="align-top text-xs whitespace-normal">
                        {RUN_STATE_TEXT[entry.runState] ?? entry.runState ?? "—"}
                      </TableCell>
                      <TableCell className="align-top text-xs whitespace-normal">
                        {entry.counts.icons > 0 && <span className="mr-2">图标 {entry.counts.icons}</span>}
                        {entry.counts.translations > 0 && <span>文案 {entry.counts.translations}</span>}
                        {entry.counts.layout > 0 && <span className="mr-2">布局</span>}
                      </TableCell>
                      <TableCell
                        className="text-muted-foreground truncate font-mono text-xs"
                        title={entry.projectRoot}
                      >
                        {entry.projectRoot}
                      </TableCell>
                      <TableCell className="align-top text-right whitespace-normal">
                        <Button
                          size="sm"
                          variant={isActive ? "secondary" : "outline"}
                          onClick={() => setSelected(key)}
                        >
                          {isActive ? "处理中" : "处理"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {queue.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm">
                      {loaded ? (
                        <span className="text-muted-foreground">当前没有待确认的页面。</span>
                      ) : (
                        <PixelLoader text="请稍等，正在读取待确认的页面" className="py-4" />
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="text-muted-foreground text-xs">
            看板任务停在语义判断点时，产物在它自己的工作目录里；上表里的路径就是那个目录。
          </div>
        </CardContent>
      </Card>

      {active && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {active.target || "（未指定 Target）"}
              {!queue.some((item) => keyOf(item) === selected) && manualRoot.trim() ? " —— 手填" : ""}
            </CardTitle>
            <CardDescription className="text-xs">
              <IdentifierText text={active.projectRoot} />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PendingPanel
              projectRoot={active.projectRoot}
              target={active.target}
              taskId={active.taskId}
              runId={active.runId}
              automation={automation}
              onResumed={() => void load()}
            />
            {active.counts.layout > 0 && active.taskId && (
              <LayoutPanel taskId={active.taskId} projectRoot={active.projectRoot} target={active.target} updatedAt="" />
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">手动指定</CardTitle>
          <CardDescription>
            列表里没有的（例如客户端重启过、或者路径不在已知运行里）可以手填。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="review-project">工程目录 / 工作目录</Label>
            <Input
              id="review-project"
              spellCheck={false}
              value={manualRoot}
              onChange={(event) => {
                setManualRoot(event.target.value)
                setSelected("")
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="review-target">页面 Target</Label>
            <Input
              id="review-target"
              spellCheck={false}
              value={manualTarget}
              onChange={(event) => {
                setManualTarget(event.target.value)
                setSelected("")
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
