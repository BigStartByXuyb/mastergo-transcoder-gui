import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { DoneBoard } from "@/app/done-board"
import { DesignImageCard } from "@/app/design-image-card"
import { LayoutPanel } from "@/app/layout-panel"
import { NewTaskCard } from "@/app/new-task-card"
import { PendingPanel } from "@/app/pending-panel"
import { StepCard } from "@/app/step-card"
import { TaskDetailCard } from "@/app/task-detail-card"
import { TaskLogCard } from "@/app/task-log-card"
import { StepRail, type StepRow } from "@/app/task-steps"
import { useIdentity } from "@/app/use-identity"
import { useRunLog } from "@/app/use-run-log"
import { Button } from "@/components/ui/button"
import { ApiFailure, api, type Board, type Pending, type PipelineStep, type PluginSummary } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { AUTOMATION_LABEL, adoptsIdentityWithoutConfirm, readTaskForm, writeTaskForm, type TaskForm } from "@/lib/task-form"
import { POLL_MS, canStop, hasProducts, isBusyState, isInFlight, pendingInputCount, waitingCounts } from "@/lib/task-state"

/*
 * 流水线：新建任务 + 看某个任务的详情。
 *
 * 任务只有一套登记（看板）：这里「开始」等于「加入看板并启动」，看板的「详情」跳到这里，
 * 两边看的是同一个任务的同一份步骤登记。执行引擎、工作目录、并发与合并都在后端做。
 *
 * 本文件只做编排：表单在 NewTaskCard；任务详情按「步骤条 + 当前那一步的界面」摆，每步的界面见 StepCard；
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
  /** 详情区现在看哪一步（空串 = 任务总览）。 */
  const [step, setStep] = useState("")
  /*
   * 两屏：带 `task=<id>` 进来（从看板点「详情」、或刚「加入看板并开始」）就是看那个任务；
   * 点「新建任务」回到表单。两屏不再同屏堆着，详情里也只有左边选中的那一步。
   */
  const [formOpen, setFormOpen] = useState(!taskId)

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
  const running = task !== null && isBusyState(task.state)
  const showProducts = task !== null && hasProducts(task.state)
  const counts = waitingCounts(pending)
  /** 这次运行停在哪一步（补输入与合并都会写 failure，空串 = 没停）。 */
  const stopStep = task?.failure?.stepName ?? ""
  /*
   * 步骤条的数据：顺序与标题取插件的步骤契约，状态/耗时取这一次运行的登记表 —— 两份并一份，
   * 没跑到的那几步照样列出来（标「未开始」）。
   */
  const stepRows: StepRow[] = useMemo(() => {
    if (!task) return []
    return contract.map((item) => {
      const run = task.steps.find((item2) => item2.name === item.Name) ?? null
      return {
        id: item.Id,
        name: item.Name,
        title: item.Title,
        status: run ? run.status : "pending",
        seconds: run ? run.seconds : 0,
        humanInput: run ? run.humanInput : false,
        aiFill: run && run.aiFill ? run.aiFill.filled : [],
        aiFillNote:
          run && run.aiFill && run.aiFill.stoppedAt && run.aiFill.stoppedAt !== item.Name
            ? "（当时停在第 " + (contract.find((step) => step.Name === run.aiFill?.stoppedAt)?.Id ?? "?") + " 步）"
            : "",
        note: run ? run.note : ""
      }
    })
  }, [contract, task])
  // 任务推进到新的停点时自动切到那一步；人自己点过别的步骤就停在人点的那一步。
  useEffect(() => {
    if (stopStep) setStep(stopStep)
  }, [stopStep, task?.jobId])
  /*
   * 现在显示的这一步：契约里有就用它；契约还没读到（或那一步不在契约里）就用登记表造一行，
   * 保证点哪一步都不会变成空白。
   */
  const currentRow: StepRow =
    stepRows.find((item) => item.name === step) ??
    (() => {
      const run = task?.steps.find((item) => item.name === step) ?? null
      return {
        id: run ? run.id : 0,
        name: step,
        title: step,
        status: run ? run.status : "pending",
        seconds: run ? run.seconds : 0,
        humanInput: run ? run.humanInput : false,
        aiFill: run && run.aiFill ? run.aiFill.filled : [],
        aiFillNote: "",
        note: run ? run.note : ""
      }
    })()

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

  /*
   * 路由决定这一屏显示什么：带 `task=<id>`（看板点「详情」、或刚「加入看板并开始」）看那个任务；
   * 不带（侧边栏「+ 新建任务」）就是新建表单。两屏之间不在页内互相跳 —— 换屏走侧边栏/看板。
   */
  useEffect(() => {
    if (!taskId) {
      setFormOpen(true)
      return
    }
    setCurrentId(taskId)
    setFormOpen(false)
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
      {/* 表单与详情是两屏；没有选中任务时（任务被移除 / 只是进来看看）一定给表单。 */}
      {(formOpen || !task) && (
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
      )}

      {(formOpen || !task) && task && (
        <p className="text-muted-foreground text-sm">
          上面填好点「加入看板并开始」，或在看板点某个任务的「详情」——那是另一屏，按步骤看。
        </p>
      )}

      {/*
        详情按「步骤条 + 当前那一步的界面」摆：左边一条 12 步（点一步切过去），右边只显示那一步的东西，
        不再把每步的输入挤在一屏里。停在哪一步就自动切到那一步。
      */}
      {task && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <StepRail
            rows={stepRows}
            current={step}
            stopStep={stopStep}
            onPick={setStep}
            onPickOverview={() => setStep("")}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex items-center justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  window.location.hash = "board"
                }}
              >
                在看板里看
              </Button>
            </div>
            {step === "" ? (
              <>
                <TaskDetailCard
                  task={task}
                  contractStep={contract.find((item) => item.Name === task.failure?.stepName) ?? null}
                  stopStepNumber={contract.find((item) => item.Name === task.failure?.stepName)?.Id ?? 0}
                  allStepsDone={stepRows.length > 0 && stepRows.every((row) => row.status === "ok" || row.status === "skipped")}
                  busy={busy}
                  onResume={() => void resume()}
                  onMerge={merge}
                  onResolve={resolveConflict}
                />
                {/* 产物与这一次运行的日志都属于「任务总览」：它们说的不是某一步，别在每一步下面都挂一遍。 */}
                {showProducts && task.workDir && <DoneBoard projectRoot={task.workDir} target={task.request.target} />}
                {job && <TaskLogCard logText={logText} logRef={logRef} />}
              </>
            ) : (
              <StepCard
                row={currentRow}
                contractStep={contract.find((item) => item.Name === step) ?? null}
                logPath={task.failure?.stepName === step ? task.failure.logPath : ""}
                failureMessage={task.failure?.stepName === step ? task.failure.message : ""}
              >
                {/*
                  走 A 路线（mw-wpf）的任务才读图：AB 的 A 段同样读，所以判据是「路线里有 A」。
                  图与分组表都属于「布局」那一步的输入，所以它们挂在这一步的界面里。
                */}
                {step === "layout" && task.workDir && task.request.target && task.routes.includes("A") && (
                  <div className="flex flex-col gap-3">
                    <DesignImageCard task={task} />
                    <LayoutPanel
                      taskId={task.id}
                      runId={task.jobId}
                      resume
                      projectRoot={task.workDir}
                      target={task.request.target}
                      updatedAt={task.updatedAt}
                      progressDone={task.progress?.done}
                      confirmable={!isInFlight(task.state)}
                    />
                  </div>
                )}

                {/* 图标与文案要人补时，面板挂在「停在这里」的那一步上（补完就从这一步继续）。 */}
                {step === stopStep && pendingInputCount(counts) > 0 && task.workDir && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground text-xs">
                        当前自动化层级：{AUTOMATION_LABEL[automation] ?? automation}
                        {automation === "assist" ? "（AI 自动出候选，你确认后继续）" : ""}
                        {automation === "auto" ? "（AI 自动出候选并直接继续）" : ""}
                        {automation === "off" ? "（不叫模型，全人工填）" : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          window.location.hash = "review"
                        }}
                      >
                        在独立页面打开
                      </Button>
                    </div>
                    <PendingPanel
                      projectRoot={task.workDir}
                      target={task.request.target}
                      taskId={task.id}
                      runId={task.jobId}
                      reloadKey={task.id + ":" + task.updatedAt}
                      automation={automation}
                      onResumed={() => void loadBoard()}
                    />
                  </div>
                )}
              </StepCard>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
