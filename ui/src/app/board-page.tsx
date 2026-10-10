/*
 * 看板：一屏同时跑多个页面。
 *
 * 这一页的主体是任务表；工程、模式、链接只在要加任务时填，收进「创建任务」弹窗。
 * 上面一排筛选（工作区 / 区域 / 状态），列表按页给，一页十条，页面本身不往下拖。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { GitMerge, Loader2, Play, Plus } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { BoardNewTaskDialog } from "@/app/board-new-task-dialog"
import { BoardFilterRow } from "@/app/board-filter-row"
import { BoardTaskTable } from "@/app/board-task-table"
import { ClampText } from "@/app/clamp-text"
import { EffectiveToggle } from "@/app/effective-toggle"
import { Pager } from "@/app/pager"
import { useValueRunner } from "@/app/use-action-runner"
import { useBoardTasks } from "@/app/use-board-tasks"
import { useIdentityFill } from "@/app/use-identity-fill"
import { api, type Board } from "@/lib/api"
import { fillTargets, keepPickedImages, parseBoardItems, withPickedImage } from "@/lib/board-items"
import { filterTasks, hasFilters, readBoardFilters, writeBoardFilters, type BoardFilters } from "@/lib/board-filters"
import { useOnlyEffective } from "@/lib/use-only-effective"
import { coverageOf, visibleByCoverage, type Coverage } from "@/lib/board-effective"
import { readBoardForm, writeBoardForm, type BoardTaskForm } from "@/lib/board-form"
import { describeFailure } from "@/lib/describe-failure"
import { pageSlice } from "@/lib/paging"
import { picksForCreated, stagePickedImages } from "@/app/stage-design-images"
import { FINISHED_STATES } from "@/lib/task-state"
import { useSettings } from "@/lib/use-settings"

// 一页十条：一屏放得下，多出来的翻页。
const PAGE_SIZE = 10

export function BoardPage() {
  // 看板快照与这条线上的失败提示都由 use-board-tasks 一处管（取数、轮询、动作回来的替换）。
  const { board, setBoard, problem, setProblem } = useBoardTasks()
  const [form, setForm] = useState<BoardTaskForm>(readBoardForm)
  const [busy, setBusy] = useState("")
  const [adding, setAdding] = useState(false)
  /** 创建任务时先选好的设计稿位图：一行（一个页面）一份，按链接记；文件不进 localStorage。 */
  const [images, setImages] = useState<Record<string, File>>({})
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<BoardFilters>(readBoardFilters)
  // 「只看生效」与区域页共用一份记忆；它不属于创建任务那张表单。
  const { onlyEffective, setOnlyEffective } = useOnlyEffective()
  const [identityFailure, setIdentityFailure] = useState("")
  const { settings } = useSettings()

  // 补完 Target 就写回链接行：任务创建与运行读的都是这一份文本。
  const identity = useIdentityFill({
    automation: settings?.automation ?? "assist",
    onFilled: (targets) => setForm((current) => ({ ...current, links: fillTargets(current.links, targets) })),
    onFailure: setIdentityFailure
  })

  useEffect(() => {
    writeBoardForm(form)
  }, [form])

  useEffect(() => {
    writeBoardFilters(filters)
  }, [filters])

  /*
   * 合并全部要一个工程：筛选选了哪个工作区就用哪个（人在看哪个就合哪个），
   * 没选时取任务最多的那个，用不着人再填一遍。
   */
  const projectRoot = useMemo(() => {
    if (filters.projectRoot) return filters.projectRoot
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
  }, [board, filters.projectRoot])

  /*
   * 这一页的动作走共用骨架（ui/src/app/use-action-runner.ts）：成功把最新看板换上去并清掉提示，
   * 失败把原话同时写进页内提示与 toast —— 骨架只管前者，toast 由 done 之外的失败反应补。
   */
  const run = useValueRunner({
    setWorking: setBusy,
    setFailure: setProblem,
    onFailure: (error: unknown) => toast.error(describeFailure(error))
  })
  /* 每个动作回来的都是最新看板：换上去就完事（成功与失败的写法都在骨架那一处）。 */
  const applyBoard = useCallback((payload: { board: Board }) => setBoard(payload.board), [setBoard])
  /*
   * 任务表要的形状是「给个动作、把回来的看板换上去」：这里只把共用骨架套成那个形状，
   * 骨架（置忙 / 清错 / 失败原话 / 收尾）仍只有 use-action-runner 那一份。
   */
  const runBoardAction = useCallback(
    async (key: string, action: () => Promise<{ board: Board }>) => {
      await run(key, action, applyBoard)
    },
    [run, applyBoard]
  )

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
    void run(
      "add",
      async () => {
        const added = await api.boardAdd({
          projectRoot: form.projectRoot.trim(),
          ui: form.ui.trim(),
          autoMerge: form.autoMerge,
          overwrite: form.overwrite,
          stopAfter: form.stopAfter.trim(),
          items
        })
        // 建完任务才暂存（暂存件按任务 id 落键）：门禁、逐张送、失败怎么说都在 ui/src/app/stage-design-images.ts。
        await stagePickedImages(form.mode, picksForCreated(added.board, added.created, images))
        return added
      },
      applyBoard
    ).then((added) => {
      if (added) setImages({})
      setAdding(false)
    })
  }

  function fillIdentity() {
    const items = parseBoardItems(form.links, form.mode)
    if (!form.projectRoot.trim()) {
      toast.error("先填工程目录")
      return
    }
    if (items.length === 0) {
      toast.error("一行一个 MasterGo 链接，至少一行")
      return
    }
    void identity.run(items, form.projectRoot, form.ui)
  }

  /* 链接或工程改了，上一次的补全结论就不作数了。 */
  function changeForm(next: BoardTaskForm) {
    if (next.links !== form.links || next.projectRoot !== form.projectRoot || next.ui !== form.ui) identity.reset()
    if (next.links !== form.links) setImages((current) => keepPickedImages(current, next.links))
    setForm(next)
  }

  // 同一个引用给下面几处 memo 用：board 为空的两次渲染不该算出两个不同的空数组。
  const tasks = useMemo(() => board?.tasks ?? [], [board])
  const filtered = useMemo(() => filterTasks(tasks, filters), [tasks, filters])
  const readyCount = tasks.filter((task) => task.state === "ready").length
  const coverage: Map<string, Coverage> = useMemo(() => coverageOf(tasks), [tasks])
  const { shown, hidden: coveredCount } = visibleByCoverage(filtered, coverage, onlyEffective)

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
            checked={onlyEffective}
            hidden={coveredCount}
            onChange={setOnlyEffective}
          />
          <Button
            variant="outline"
            disabled={busy !== "" || !tasks.some((task) => task.state === "queued")}
            onClick={() => void run("start-all", () => api.boardStart(), applyBoard)}
          >
            {busy === "start-all" ? <Loader2 className="animate-spin" /> : <Play />}
            启动全部
          </Button>
          <Button
            variant="outline"
            disabled={busy !== "" || readyCount === 0 || !projectRoot}
            onClick={() => void run("merge-all", () => api.boardMergeAll(projectRoot), applyBoard)}
          >
            {busy === "merge-all" ? <Loader2 className="animate-spin" /> : <GitMerge />}
            合并全部
          </Button>
          <Button
            variant="ghost"
            disabled={busy !== "" || tasks.length === 0}
            onClick={() => void run("clear", () => api.boardClear(FINISHED_STATES), applyBoard)}
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
          <BoardFilterRow tasks={tasks} filters={filters} shown={filtered.length} onChange={setFilters} />
          <Pager page={page} total={shown.length} size={PAGE_SIZE} onPage={setPage} />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <BoardTaskTable
              tasks={pageSlice(shown, page, PAGE_SIZE)}
              coverage={coverage}
              busy={busy}
              onRun={runBoardAction}
              onCreate={() => setAdding(true)}
              filtered={hasFilters(filters)}
              hiddenByEffective={coveredCount}
            />
          </div>
        </CardContent>
      </Card>

      <BoardNewTaskDialog
        open={adding}
        form={form}
        images={images}
        busy={busy === "add"}
        automation={settings?.automation ?? "assist"}
        identity={identity}
        identityFailure={identityFailure}
        onChange={changeForm}
        onPickImage={(link, file) => setImages((current) => withPickedImage(current, link, file))}
        onOpenChange={setAdding}
        onSubmit={addTasks}
        onFill={fillIdentity}
      />
    </div>
  )
}
