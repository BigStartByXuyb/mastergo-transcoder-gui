import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronRight, GitMerge, Loader2, Play, Square, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { api, type Board, type BoardTask } from "@/lib/api"
import { parseBoardItems } from "@/lib/board-items"
import { boardStateVariant } from "@/lib/board-state"
import { describeFailure } from "@/lib/describe-failure"
import { readStored, writeStored } from "@/lib/storage"
import { POLL_MS, occupiesSlot } from "@/lib/task-state"

/*
 * 看板：一屏同时跑多个页面。
 *
 * 每个任务在自己的工作目录里跑流水线，跑完合回主工程 —— 隔离与合并都由后端做，
 * 这里只负责把状态显示出来、把动作传过去。状态一律读后端的快照，不自己推。
 */

const STORAGE_KEY = "mastergo-transcoder-gui.board"
const EMPTY_FORM: Form = { projectRoot: "", ui: "", mode: "B", autoMerge: true, overwrite: false, stopAfter: "", links: "" }

type Form = {
  projectRoot: string
  ui: string
  mode: "A" | "B" | "AB"
  autoMerge: boolean
  overwrite: boolean
  stopAfter: string
  links: string
}

function readForm(): Form {
  return readStored(STORAGE_KEY, EMPTY_FORM, (raw) => ({
    projectRoot: String(raw.projectRoot ?? ""),
    ui: String(raw.ui ?? ""),
    mode: raw.mode === "A" || raw.mode === "AB" ? raw.mode : "B",
    autoMerge: raw.autoMerge !== false,
    overwrite: raw.overwrite === true,
    stopAfter: String(raw.stopAfter ?? ""),
    links: String(raw.links ?? "")
  }))
}

export function BoardPage() {
  const [board, setBoard] = useState<Board | null>(null)
  const [problem, setProblem] = useState("")
  const [form, setForm] = useState<Form>(readForm)
  const [busy, setBusy] = useState("")

  useEffect(() => {
    writeStored(STORAGE_KEY, form)
  }, [form])

  useEffect(() => {
    let alive = true
    const load = () => {
      api
        .board()
        .then((payload) => {
          if (!alive) return
          setBoard(payload.board)
          setProblem("")
        })
        .catch((error) => {
          if (!alive) return
          // 轮询失败保留上一份数据：界面不该因为一次抖动就空掉。
          setProblem(describeFailure(error))
        })
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const projectRoot = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of board?.tasks ?? []) {
      const key = task.request.projectRoot
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let best = ""
    let bestCount = 0
    for (const [key, value] of counts) {
      if (value > bestCount) {
        best = key
        bestCount = value
      }
    }
    return best
  }, [board])

  const run = useCallback(async (key: string, action: () => Promise<{ board: Board }>) => {
    setBusy(key)
    try {
      const payload = await action()
      setBoard(payload.board)
      setProblem("")
    } catch (error) {
      const message = describeFailure(error)
      setProblem(message)
      toast.error(message)
    } finally {
      setBusy("")
    }
  }, [])

  function addTasks() {
    const items = parseBoardItems(form.links, form.mode)
    if (!form.projectRoot.trim()) {
      toast.error("先填工程目录")
      return
    }
    if (items.length === 0) {
      toast.error("一行一个 MasterGo 链接，至少一行")
      return
    }
    void run("add", () =>
      api.boardAdd({
        projectRoot: form.projectRoot.trim(),
        ui: form.ui.trim(),
        autoMerge: form.autoMerge,
        overwrite: form.overwrite,
        stopAfter: form.stopAfter.trim(),
        items
      })
    )
  }

  const tasks = board?.tasks ?? []
  const readyCount = tasks.filter((task) => task.state === "ready").length

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      {problem && (
        <Alert variant="destructive">
          <AlertTitle>看板没读到最新状态</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>看板</CardTitle>
          <CardDescription>
            每个任务在自己的工作目录里跑完整流水线，跑完合回主工程。并发上限按本机逻辑核数给：
            {board ? ` ${board.limits.limit} / ${board.limits.logical} 核` : " …"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">正在跑 {board?.running ?? 0}</Badge>
            <Badge variant={readyCount > 0 ? "default" : "outline"}>待合并 {readyCount}</Badge>
            <Badge variant="outline">任务 {tasks.length}</Badge>
            {board?.workRoot && (
              <span className="text-muted-foreground truncate font-mono text-xs" title={board.workRoot}>
                工作目录 {board.workRoot}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy !== "" || !tasks.some((task) => task.state === "queued")}
              onClick={() => void run("start-all", () => api.boardStart())}
            >
              {busy === "start-all" ? <Loader2 className="animate-spin" /> : <Play />}
              启动全部
            </Button>
            <Button
              variant="outline"
              disabled={busy !== "" || readyCount === 0 || !projectRoot}
              onClick={() => void run("merge-all", () => api.boardMergeAll(projectRoot))}
            >
              {busy === "merge-all" ? <Loader2 className="animate-spin" /> : <GitMerge />}
              合并全部
            </Button>
            <Button
              variant="ghost"
              disabled={busy !== "" || tasks.length === 0}
              onClick={() => void run("clear", () => api.boardClear(["merged", "failed", "stopped", "conflict"]))}
            >
              清掉已结束
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>加入任务</CardTitle>
          <CardDescription>
            一行一个链接；要指定页面名就写 <span className="font-mono">链接 | Target</span>。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-project">工程目录</Label>
              <Input
                id="board-project"
                spellCheck={false}
                value={form.projectRoot}
                onChange={(event) => setForm({ ...form, projectRoot: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-ui">Ui 前缀</Label>
              <Input
                id="board-ui"
                spellCheck={false}
                placeholder="例如 Test —— Target 推不出来时必填"
                value={form.ui}
                onChange={(event) => setForm({ ...form, ui: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>默认模式</Label>
              <Select value={form.mode} onValueChange={(value) => setForm({ ...form, mode: value as Form["mode"] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="B">B —— MTSLG IOContorl</SelectItem>
                  <SelectItem value="A">A —— MW WPF</SelectItem>
                  <SelectItem value="AB">AB —— 两条都跑</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
              <div className="leading-tight">
                <div className="text-sm">跑完自动合并</div>
                <div className="text-muted-foreground text-xs">冲突时一律停下等人，不自动选边。</div>
              </div>
              <Switch checked={form.autoMerge} onCheckedChange={(value) => setForm({ ...form, autoMerge: value })} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
              <div className="leading-tight">
                <div className="text-sm">替换已有产物</div>
                <div className="text-muted-foreground text-xs">
                  工程里已经有同名页面时才会用到；默认不替换，同名就停在 bundle。
                </div>
              </div>
              <Switch checked={form.overwrite} onCheckedChange={(value) => setForm({ ...form, overwrite: value })} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-stop">停在某一步（可选）</Label>
              <Input
                id="board-stop"
                spellCheck={false}
                placeholder="例如 discover —— 先出待命名清单"
                value={form.stopAfter}
                onChange={(event) => setForm({ ...form, stopAfter: event.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="board-links">MasterGo 链接</Label>
            <Textarea
              id="board-links"
              rows={5}
              spellCheck={false}
              placeholder={"https://mastergo.com/goto/xxxx?file=…&layer_id=…\nhttps://mastergo.com/goto/yyyy?file=…&layer_id=… | F3Align"}
              value={form.links}
              onChange={(event) => setForm({ ...form, links: event.target.value })}
            />
            {/* 区域前缀的去向：Target 带前缀（F3Align）时插件会自己推出来；两处都空且工程没登记表就会在入口停下。 */}
            <p className="text-muted-foreground text-xs">
              链接里写的 Target（`链接 | F3Align`）带编号前缀、或大写开头（`HomeContent`）时，UI 前缀插件会自动推出来；
              写成小写/下划线（如 `test_mastergp`）两条都推不出来，必须自己填 Ui 前缀。UI 与 Target 都空、
              工程又没有 <span className="font-mono">docs/page-registry.json</span> 时，插件会在入口停下要求显式给出。
            </p>
          </div>
          <div className="flex justify-end">
            <Button disabled={busy !== ""} onClick={addTasks}>
              {busy === "add" ? <Loader2 className="animate-spin" /> : null}
              加入看板
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>任务</CardTitle>
          <CardDescription>状态、进度、失败原因都来自后端快照；冲突不猜，停下等人。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">状态</TableHead>
                  <TableHead className="w-40">Target</TableHead>
                  <TableHead className="w-16">模式</TableHead>
                  <TableHead className="w-56">进度</TableHead>
                  <TableHead>工作目录 / 说明</TableHead>
                  <TableHead className="w-44 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    busy={busy}
                    run={run}
                  />
                ))}
                {tasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground py-8 text-center text-sm">
                      还没有任务。填工程目录与链接，加进来再启动。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function TaskRow({
  task,
  busy,
  run
}: {
  task: BoardTask
  busy: string
  run: (key: string, action: () => Promise<{ board: Board }>) => Promise<void>
}) {
  const progress = task.progress
  const done = progress?.done ?? 0
  const total = progress?.total ?? 0
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  const blocked = busy !== ""

  return (
    <>
    <TableRow>
      <TableCell>
        <Badge variant={boardStateVariant(task.state)}>{task.stateLabel}</Badge>
      </TableCell>
      <TableCell className="font-mono text-xs break-all">{task.request.target || "（按设计稿推导）"}</TableCell>
      <TableCell className="text-sm">{task.request.mode}</TableCell>
      <TableCell>
        {progress ? (
          <div className="flex flex-col gap-1">
            <Progress value={percent} />
            <span className="text-muted-foreground truncate text-xs" title={progress.currentTitle}>
              {done}/{total} {progress.currentTitle ? "· " + progress.currentTitle : ""}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground truncate font-mono text-xs" title={task.workDir || task.request.projectRoot}>
            {task.workDir || task.request.projectRoot}
          </span>
          {task.error && <span className="text-destructive text-xs">{task.error}</span>}
          {task.failure && task.failure.kind !== "semantic" && (
            <span className="text-destructive text-xs">
              {task.failure.title || task.failure.stepName}：{task.failure.message}
              {task.failure.logPath && (
                <span className="text-muted-foreground block font-mono" title={task.failure.logPath}>
                  {task.failure.logPath}
                </span>
              )}
            </span>
          )}
          {task.failure && task.failure.kind === "semantic" && (
            <span className="text-muted-foreground text-xs">
              停在语义判断点，不是错误：{task.failure.title || task.failure.stepName}
              {task.failure.message ? " —— " + task.failure.message : ""}
            </span>
          )}
          {task.state === "waiting" && (
            <span className="text-muted-foreground text-xs">
              AI 会自动补输入；补不动就去「待确认」列表处理（产物在它自己的工作目录里）。
            </span>
          )}
          {task.merge && task.merge.conflicts.length === 0 && (
            <span className="text-muted-foreground text-xs">已合并 {task.merge.applied.length} 个文件</span>
          )}
          {task.merge && task.merge.conflicts.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-destructive text-xs">默认不猜：停下等人处理。冲突 {task.merge.conflicts.length} 处</span>
              {task.merge.conflicts.map((conflict) => (
                <span key={conflict.path} className="text-xs">
                  <span className="font-mono">{conflict.path}</span> —— {conflict.reason}
                </span>
              ))}
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.location.hash = "pipeline?task=" + task.id
            }}
          >
            <ChevronRight />
            详情
          </Button>
          {task.state === "queued" && (
            <Button size="sm" disabled={blocked} onClick={() => void run(task.id + ":start", () => api.boardStart(task.id))}>
              <Play /> 启动
            </Button>
          )}
          {occupiesSlot(task.state) && task.state !== "merging" && (
            <Button
              size="sm"
              variant="outline"
              disabled={blocked}
              onClick={() => void run(task.id + ":stop", () => api.boardStop(task.id))}
            >
              <Square /> 停止
            </Button>
          )}
          {(task.state === "ready" || task.state === "conflict") && (
            <Button size="sm" disabled={blocked} onClick={() => void run(task.id + ":merge", () => api.boardMerge(task.id))}>
              <GitMerge /> {task.state === "conflict" ? "重新合并" : "合并"}
            </Button>
          )}
          {["merged", "failed", "stopped", "conflict"].includes(task.state) && (
            <Button
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => void run(task.id + ":remove", () => api.boardRemove(task.id))}
            >
              <Trash2 /> 移除
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
    </>
  )
}

