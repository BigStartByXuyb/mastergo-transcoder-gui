import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { DoneBoard } from "@/app/done-board"
import { DesignImageCard } from "@/app/design-image-card"
import { LayoutPanel } from "@/app/layout-panel"
import { NewTaskCard } from "@/app/new-task-card"
import { TaskDetailCard } from "@/app/task-detail-card"
import { TaskLogCard } from "@/app/task-log-card"
import { TaskPendingCard } from "@/app/task-pending-card"
import { useIdentity } from "@/app/use-identity"
import { useRunLog } from "@/app/use-run-log"
import { ApiFailure, api, type Board, type Pending, type PipelineStep, type PluginSummary } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { adoptsIdentityWithoutConfirm, readTaskForm, writeTaskForm, type TaskForm } from "@/lib/task-form"
import { POLL_MS, canStop, hasProducts, isBusyState, waitingCounts } from "@/lib/task-state"

/*
 * 流水线：新建任务 + 看某个任务的详情。
 *
 * 任务只有一套登记（看板）：这里「开始」等于「加入看板并启动」，看板的「详情」跳到这里，
 * 两边看的是同一个任务的同一份步骤登记。执行引擎、工作目录、并发与合并都在后端做。
 *
 * 本文件只做编排：表单在 NewTaskCard，详情 / 待确认 / 日志各一张卡，
 * 身份补全在 useIdentity，运行日志在 useRunLog，判定逻辑在 src/lib。
 */

export function PipelinePage({
  taskId,
  initialArea
}: {
  taskId: string
  /** 从某个区域点「复制区域模板并新建任务」进来时，回填工程目录与区域。 */
  initialArea?: { projectRoot: string; ui: string } | null
}) {
  const [plugin, setPlugin] = useState<PluginSummary | null>(null)
  const [contract, setContract] = useState<PipelineStep[]>([])
  const [board, setBoard] = useState<Board | null>(null)
  const [currentId, setCurrentId] = useState(taskId)
  const [pending, setPending] = useState<Pending | null>(null)
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState("")
  const [automation, setAutomation] = useState("assist")
  const [form, setForm] = useState<TaskForm>(() => readTaskForm())

  // 区域模板：工程与区域是团队/项目约定，不来自设计稿，所以可以整条回填（Target 与链接不回填）。
  useEffect(() => {
    if (!initialArea) return
    setForm((current) => ({ ...current, projectRoot: initialArea.projectRoot, ui: initialArea.ui }))
  }, [initialArea?.projectRoot, initialArea?.ui])

  function patchForm(patch: Partial<TaskForm>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  const identity = useIdentity({
    link: form.link,
    projectRoot: form.projectRoot,
    target: form.target,
    ui: form.ui,
    automation,
    onFailure: setFailure,
    onPicked: (nextTarget, nextUi) => patchForm({ target: nextTarget, ui: nextUi })
  })

  const task = useMemo(
    () => (board?.tasks ?? []).find((item) => item.id === currentId) ?? null,
    [board, currentId]
  )
  const stepTitles = useMemo(() => {
    const map = new Map<string, string>()
    for (const step of contract) map.set(step.Name, step.Title)
    return map
  }, [contract])
  const running = task !== null && isBusyState(task.state)
  const showProducts = task !== null && hasProducts(task.state)
  const contractStep = task?.failure ? contract.find((step) => step.Name === task.failure?.stepName) ?? null : null
  const counts = waitingCounts(pending)

  const { job, setJob, logText, logRef, reset } = useRunLog(task?.jobId ?? "")

  // 看板是任务的唯一登记：详情页的状态一律从它的快照读，不自己推。
  const loadBoard = useCallback(
    () =>
      api
        .board()
        .then((payload) => setBoard(payload.board))
        .catch(() => undefined),
    []
  )

  useEffect(() => {
    void loadBoard()
    const timer = window.setInterval(() => void loadBoard(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [loadBoard])

  useEffect(() => {
    api
      .plugin()
      .then((payload) => {
        setPlugin(payload.plugin)
        setContract(payload.steps)
      })
      .catch((error) => setFailure(describeFailure(error)))
    api
      .settingsGet()
      .then((payload) => setAutomation(payload.settings.automation))
      .catch(() => undefined)
  }, [])

  // 从看板点「详情」进来时 URL 带 task=<id>：跟着它切换当前任务。
  useEffect(() => {
    if (taskId) setCurrentId(taskId)
  }, [taskId])

  /*
   * 任务停下来后看一眼有没有待确认项：有就说明这次停是插件设计的语义判断停点
   * （等人/AI 补输入），不是错误。产物在任务自己的工作目录里，所以这里读 workDir。
   */
  useEffect(() => {
    if (!task || !task.workDir || running) {
      setPending(null)
      return
    }
    let stopped = false
    api
      .pending(task.workDir, task.request.target)
      .then((payload) => {
        if (!stopped) setPending(payload.pending)
      })
      .catch(() => {
        if (!stopped) setPending(null)
      })
    return () => {
      stopped = true
    }
  }, [task?.id, task?.workDir, task?.request.target, task?.state, running])

  // 开始 = 新建看板任务 + 启动它；看板负责建工作目录、并发与合并。
  async function start() {
    setFailure("")
    writeTaskForm(form)
    setBusy("start")
    try {
      /*
       * 自动化层级是「自动」时身份也不必先点按钮：启动前自己补一遍（与插件跑法里 agent 做的一致）。
       * 自动只在「这一页登记过区域」时成立：区域是团队对项目的约定、设计稿里没有，
       * 这一页没登记过时 pick 停下来把原因写进 failure，让人点一次——那一次是项目事实。
       */
      let finalTarget = form.target.trim()
      let finalUi = form.ui.trim()
      if (!finalTarget && !finalUi && adoptsIdentityWithoutConfirm(automation)) {
        // 与按钮同一条实现：落后端取候选 → 写登记表 → 回填；要人决策时 pick 已经把原因写进 failure。
        const picked = await identity.pick()
        if (!picked) return
        await identity.apply(picked)
        finalTarget = picked.target
        finalUi = picked.ui
      }
      const added = await api.boardAdd({
        projectRoot: form.projectRoot,
        ui: finalUi,
        autoMerge: true,
        stopAfter: form.stopAfter,
        overwrite: form.overwrite,
        items: [{ link: form.link, target: finalTarget, mode: form.mode as "A" | "B" | "AB" }]
      })
      const created = added.created[0] ?? ""
      await api.boardStart(created)
      setBoard(added.board)
      setCurrentId(created)
      window.location.hash = "pipeline?task=" + created
      toast.success("已加入看板并开始")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  async function stop() {
    if (!task) return
    setBusy("stop")
    try {
      const payload = await api.boardStop(task.id)
      setBoard(payload.board)
    } catch (error) {
      toast.error(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  // 从断点继续：后端按看板任务取第一条没跑完的路线，参数与停点从任务与登记表重建。
  async function resume() {
    if (!task) return
    setBusy("resume")
    setFailure("")
    try {
      const payload = await api.runResume(task.id)
      reset()
      setJob(payload.job)
      toast.success(
        "已继续：路线 " +
          payload.mode +
          (payload.resumedFrom === "起点" ? "（从起点）" : "（从 " + payload.resumedFrom + "）") +
          (payload.recomputedManifest ? "；已有页面 → 回到生成 Bundle 清单的那一步重算" : "") +
          (payload.reconciled && (payload.reconciled.removed > 0 || payload.reconciled.renamed > 0)
            ? "；命名表已修回台账口径：" +
              [
                payload.reconciled.removed > 0
                  ? "裁掉 " + payload.reconciled.removed + " 条当前不登记的下标"
                  : "",
                payload.reconciled.renamed > 0 ? "改掉 " + payload.reconciled.renamed + " 条重名资源名" : ""
              ]
                .filter(Boolean)
                .join("、")
            : "")
      )
    } catch (error) {
      setFailure(describeFailure(error))
      // 这一行已经不在看板上（被清掉、或换了工程）：把看板拉回最新，别对着不存在的任务点。
      if (error instanceof ApiFailure && error.code === "NO_TASK") void loadBoard()
    } finally {
      setBusy("")
    }
  }

  function merge() {
    if (!task) return
    setBusy("merge")
    api
      .boardMerge(task.id)
      .then((payload) => setBoard(payload.board))
      .catch((error) => toast.error(describeFailure(error)))
      .finally(() => setBusy(""))
  }

  async function resolveConflict(path: string, pick: "mine" | "main" | "clear") {
    if (!task) return
    setBusy("resolve:" + path)
    try {
      const payload = await api.boardResolve(task.id, path, pick)
      setBoard(payload.board)
    } catch (error) {
      toast.error(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  async function reloadContract() {
    try {
      const payload = await api.plugin()
      setPlugin(payload.plugin)
      setContract(payload.steps)
      toast.success("已重新读取流水线契约")
    } catch (error) {
      toast.error(describeFailure(error))
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <NewTaskCard
        form={form}
        onForm={patchForm}
        plugin={plugin}
        contract={contract}
        identity={identity}
        busy={busy}
        failure={failure}
        canStop={task !== null && canStop(task.state)}
        onStart={() => void start()}
        onStop={() => void stop()}
        onReloadContract={() => void reloadContract()}
      />

      {!task && (
        <p className="text-muted-foreground text-sm">
          还没有选中的任务。上面填好点「加入看板并开始」，或在看板点某个任务的「详情」。
        </p>
      )}

      {task && (
        <TaskDetailCard
          task={task}
          contractStep={contractStep}
          stepTitles={stepTitles}
          busy={busy}
          onResume={() => void resume()}
          onMerge={merge}
          onResolve={resolveConflict}
        />
      )}

      {/*
        走 A 路线（mw-wpf）的任务才读图：AB 的 A 段同样读，所以判据是「路线里有 A」而不是 mode 恰好是 A。
        图是按页面名放的，没有 Target 就无从谈起 —— 那种任务根本不显示这一块。
      */}
      {task && task.workDir && task.request.target && task.routes.includes("A") && <DesignImageCard task={task} />}

      {task && task.workDir && task.request.target && task.routes.includes("A") && (
        <LayoutPanel
          taskId={task.id}
          projectRoot={task.workDir}
          target={task.request.target}
          updatedAt={task.updatedAt}
          progressDone={task.progress?.done}
        />
      )}

      {task && counts.total > 0 && (
        <TaskPendingCard
          task={task}
          automation={automation}
          counts={counts}
          onResumed={() => {
            void loadBoard()
          }}
        />
      )}

      {task && showProducts && task.workDir && <DoneBoard projectRoot={task.workDir} target={task.request.target} />}

      {task && job && <TaskLogCard logText={logText} logRef={logRef} />}
    </div>
  )
}
