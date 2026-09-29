import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { DoneBoard } from "@/app/done-board"
import { NewTaskCard } from "@/app/new-task-card"
import { TaskDetailCard } from "@/app/task-detail-card"
import { TaskLogCard } from "@/app/task-log-card"
import { TaskPendingCard } from "@/app/task-pending-card"
import { useIdentity } from "@/app/use-identity"
import { useRunLog } from "@/app/use-run-log"
import { api, type Board, type Pending, type PipelineStep, type PluginSummary } from "@/lib/api"
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

export function PipelinePage({ taskId }: { taskId: string }) {
  const [plugin, setPlugin] = useState<PluginSummary | null>(null)
  const [contract, setContract] = useState<PipelineStep[]>([])
  const [board, setBoard] = useState<Board | null>(null)
  const [currentId, setCurrentId] = useState(taskId)
  const [pending, setPending] = useState<Pending | null>(null)
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState("")
  const [automation, setAutomation] = useState("assist")
  const [form, setForm] = useState<TaskForm>(() => readTaskForm())

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
  useEffect(() => {
    let alive = true
    const load = () => {
      api
        .board()
        .then((payload) => {
          if (alive) setBoard(payload.board)
        })
        .catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

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
       * 区域只能来自项目既有约定，所以项目里一次都没登记过时会停下来要人给一次——那一次是项目事实。
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

  // 从断点继续：后端取这次运行里第一条没跑完的路线，继承原次运行的全部参数。
  async function resume() {
    if (!task || !task.jobId) return
    setBusy("resume")
    setFailure("")
    try {
      const payload = await api.runResume(task.jobId)
      reset()
      setJob(payload.job)
      toast.success(
        "已继续：路线 " +
          payload.mode +
          (payload.resumedFrom === "起点" ? "（从起点）" : "（从 " + payload.resumedFrom + "）") +
          (payload.recomputedManifest ? "；已有页面 → 回到生成 Bundle 清单的那一步重算" : "") +
          (payload.reconciled && payload.reconciled.removed > 0
            ? "；命名表裁掉 " + payload.reconciled.removed + " 条当前不登记的下标"
            : "")
      )
    } catch (error) {
      setFailure(describeFailure(error))
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
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <NewTaskCard
        form={form}
        onForm={patchForm}
        plugin={plugin}
        contract={contract}
        automation={automation}
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
        />
      )}

      {task && counts.total > 0 && (
        <TaskPendingCard
          task={task}
          automation={automation}
          counts={counts}
          onResumed={() => {
            void api
              .board()
              .then((payload) => setBoard(payload.board))
              .catch(() => undefined)
          }}
        />
      )}

      {task && showProducts && task.workDir && <DoneBoard projectRoot={task.workDir} target={task.request.target} />}

      {task && job && <TaskLogCard logText={logText} logRef={logRef} />}
    </div>
  )
}
