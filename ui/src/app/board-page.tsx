import { useCallback, useEffect, useMemo, useState } from "react"
import { GitMerge, Loader2, Play, Plus } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { BoardNewTaskDialog } from "@/app/board-new-task-dialog"
import { BoardTaskTable } from "@/app/board-task-table"
import { ClampText } from "@/app/clamp-text"
import { EffectiveToggle } from "@/app/effective-toggle"
import { Pager } from "@/app/pager"
import { api, type Board } from "@/lib/api"
import { parseBoardItems } from "@/lib/board-items"
import { coverageOf, type Coverage } from "@/lib/board-effective"
import { readBoardForm, writeBoardForm, type BoardTaskForm } from "@/lib/board-form"
import { describeFailure } from "@/lib/describe-failure"
import { pageSlice } from "@/lib/paging"
import { FINISHED_STATES, POLL_MS } from "@/lib/task-state"

/*
 * 看板：一屏同时跑多个页面。
 *
 * 这一页的主体是任务表；工程、模式、链接只在要加任务时填，收进「创建任务」弹窗。
 * 列表按页给，一页十条，页面本身不往下拖。
 */

// 一页十条：一屏放得下，多出来的翻页。
const PAGE_SIZE = 10

export function BoardPage() {
  const [board, setBoard] = useState<Board | null>(null)
  const [problem, setProblem] = useState("")
  const [form, setForm] = useState<BoardTaskForm>(readBoardForm)
  const [busy, setBusy] = useState("")
  const [adding, setAdding] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    writeBoardForm(form)
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

  // 合并全部要一个工程：取任务最多的那个，用不着人再填一遍。
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
    ).then(() => setAdding(false))
  }

  const tasks = board?.tasks ?? []
  const readyCount = tasks.filter((task) => task.state === "ready").length
  const coverage: Map<string, Coverage> = useMemo(() => coverageOf(tasks), [tasks])
  const shown = form.onlyEffective ? tasks.filter((task) => coverage.get(task.id) !== "covered") : tasks
  const coveredCount = tasks.length - shown.length

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {problem && (
        <Alert variant="destructive">
          <AlertTitle>看板没读到最新状态</AlertTitle>
          <AlertDescription>
            <ClampText text={problem} />
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">任务</h2>
        <Badge variant="secondary">正在跑 {board?.running ?? 0}</Badge>
        <Badge variant={readyCount > 0 ? "default" : "outline"}>待合并 {readyCount}</Badge>
        <Badge variant="outline">共 {tasks.length}</Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <EffectiveToggle
            id="board-only-effective"
            checked={form.onlyEffective}
            hidden={coveredCount}
            onChange={(value) => setForm({ ...form, onlyEffective: value })}
          />
          <Button
            variant="outline"
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
            onClick={() => void run("clear", () => api.boardClear(FINISHED_STATES))}
          >
            清掉已结束
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus />
            创建任务
          </Button>
        </div>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 pt-6">
          <Pager page={page} total={shown.length} size={PAGE_SIZE} onPage={setPage} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <BoardTaskTable
              tasks={pageSlice(shown, page, PAGE_SIZE)}
              coverage={coverage}
              busy={busy}
              onRun={run}
              onCreate={() => setAdding(true)}
            />
          </div>
        </CardContent>
      </Card>

      <BoardNewTaskDialog
        open={adding}
        form={form}
        busy={busy === "add"}
        onChange={setForm}
        onOpenChange={setAdding}
        onSubmit={addTasks}
      />
    </div>
  )
}
