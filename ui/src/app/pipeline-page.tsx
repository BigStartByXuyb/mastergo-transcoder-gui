import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { DoneBoard } from "@/app/done-board"
import { DesignImageCard } from "@/app/design-image-card"
import { LayoutPanel } from "@/app/layout-panel"
import { NewTaskCard } from "@/app/new-task-card"
import { PendingPanel } from "@/app/pending-panel"
import { StepCard } from "@/app/step-card"
import { TaskDetailCard } from "@/app/task-detail-card"
import { TaskLogCard } from "@/app/task-log-card"
import { StepRail } from "@/app/task-steps"
import { useBoardTasks } from "@/app/use-board-tasks"
import { useIdentity } from "@/app/use-identity"
import { usePending } from "@/app/use-pending"
import { useRunLog } from "@/app/use-run-log"
import { useTaskActions } from "@/app/use-task-actions"
import { Button } from "@/components/ui/button"
import { api, type PipelineStep, type PluginSummary } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { stepRowOf, stepRowsOf } from "@/lib/step-rows"
import { AUTOMATION_LABEL, adoptsIdentityWithoutConfirm, readTaskForm, writeTaskForm, type TaskForm } from "@/lib/task-form"
import { canStop, hasProducts, isBusyState, isInFlight, pendingInputCount, waitingCounts } from "@/lib/task-state"

/*
 * 流水线页：两屏 —— 新建任务（表单）与任务详情。
 *
 *   新建：`#pipeline`（侧边栏「+ 新建任务」进来）→ NewTaskCard。
 *   详情：`#pipeline?task=<id>`（看板点「详情」、或刚加入看板）→ 左边步骤条 + 右边当前那一步的界面。
 *
 * 本文件只做编排与接线：看板快照在 use-board-tasks，待确认清单在 use-pending，
 * 动作在 use-task-actions，步骤条的数据映射在 ui/src/lib/step-rows.ts，身份补全在 use-identity，
 * 运行日志在 use-run-log。每个面板自己知道自己要什么。
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
  const [currentId, setCurrentId] = useState(taskId)
  const [failure, setFailure] = useState("")
  const [automation, setAutomation] = useState("assist")
  const [form, setForm] = useState<TaskForm>(() => readTaskForm())
  /** 详情区现在看哪一步（空串 = 任务总览）。 */
  const [step, setStep] = useState("")
  /*
   * 两屏：带 `task=<id>`（从看板点「详情」、或刚「加入看板并开始」）就是看那个任务；
   * 不带（侧边栏「+ 新建任务」）就是新建表单。换屏走侧边栏/看板，页内不放互相跳的按钮。
   */
  const [formOpen, setFormOpen] = useState(!taskId)

  const { setBoard, reload, taskOf } = useBoardTasks()
  const task = taskOf(currentId)
  const running = task !== null && isBusyState(task.state)
  const showProducts = task !== null && hasProducts(task.state)
  const pending = usePending({
    workDir: task?.workDir ?? "",
    target: task?.request.target ?? "",
    running,
    reloadKey: (task?.id ?? "") + ":" + (task?.updatedAt ?? "")
  })
  const counts = waitingCounts(pending)
  const stopStep = task?.failure?.stepName ?? ""

  const registeredSteps = task?.steps ?? []
  const stepRows = useMemo(() => stepRowsOf(contract, registeredSteps), [contract, registeredSteps])
  const currentRow = useMemo(() => stepRowOf(contract, registeredSteps, step), [contract, registeredSteps, step])

  // 区域模板：工程与区域是团队/项目约定，不来自设计稿，所以可以整条回填（Target 与链接不回填）。
  useEffect(() => {
    if (!initialArea) return
    setForm((current) => ({ ...current, projectRoot: initialArea.projectRoot, ui: initialArea.ui }))
  }, [initialArea?.projectRoot, initialArea?.ui])

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

  const { job, setJob, logText, logRef, reset } = useRunLog(task?.jobId ?? "")
  const actions = useTaskActions({
    onBoard: setBoard,
    onPlugin: (nextPlugin, nextContract) => {
      setPlugin(nextPlugin)
      setContract(nextContract)
    },
    onJob: setJob,
    onJobReset: reset,
    onFailure: setFailure,
    onTaskGone: () => void reload()
  })

  // 路由决定这一屏显示什么（见上面的「两屏」）。
  useEffect(() => {
    if (!taskId) {
      setFormOpen(true)
      return
    }
    setCurrentId(taskId)
    setFormOpen(false)
  }, [taskId])

  // 任务推进到新的停点时自动切到那一步；人自己点过别的步骤就停在人点的那一步。
  useEffect(() => {
    if (stopStep) setStep(stopStep)
  }, [stopStep, task?.jobId])

  // 开始 = 新建看板任务 + 启动它；看板负责建工作目录、并发与合并。
  async function start() {
    writeTaskForm(form)
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
      const added = await actions.start({
        projectRoot: form.projectRoot,
        ui: finalUi,
        autoMerge: true,
        stopAfter: form.stopAfter,
        overwrite: form.overwrite,
        items: [{ link: form.link, target: finalTarget, mode: form.mode as "A" | "B" | "AB" }]
      })
      const created = added.created[0] ?? ""
      await actions.startJob(created)
      setCurrentId(created)
      window.location.hash = "pipeline?task=" + created
      toast.success("已加入看板并开始")
    } catch {
      // 失败原话已经由 use-task-actions 写进 failure，这里只把这一次点击收尾。
    }
  }

  const failedStep = contract.find((item) => item.Name === stopStep) ?? null
  const allStepsDone = stepRows.length > 0 && stepRows.every((row) => row.status === "ok" || row.status === "skipped")

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
          busy={actions.busy}
          failure={failure}
          canStop={task !== null && canStop(task.state)}
          onStart={() => void start()}
          onStop={() => task && void actions.stop(task)}
          onReloadContract={() => void actions.reloadContract()}
        />
      )}

      {(formOpen || !task) && task && (
        <p className="text-muted-foreground text-sm">
          上面填好点「加入看板并开始」，或在看板点某个任务的「详情」——那是另一屏，按步骤看。
        </p>
      )}

      {/*
        详情按「步骤条 + 当前那一步的界面」摆：左边一条（点一步切过去），右边只显示那一步的东西，
        不再把每步的输入挤在一屏里。停在哪一步就自动切到那一步。
      */}
      {!formOpen && task && (
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
                  contractStep={failedStep}
                  stopStepNumber={failedStep ? failedStep.Id : 0}
                  allStepsDone={allStepsDone}
                  busy={actions.busy}
                  onResume={() => void actions.resume(task)}
                  onMerge={() => actions.merge(task)}
                  onResolve={(path, pick) => actions.resolveConflict(task, path, pick)}
                />
                {/* 产物与这一次运行的日志都属于「任务总览」：它们说的不是某一步，别在每一步下面都挂一遍。 */}
                {showProducts && task.workDir && <DoneBoard projectRoot={task.workDir} target={task.request.target} />}
                {job && <TaskLogCard logText={logText} logRef={logRef} />}
              </>
            ) : (
              <StepCard
                row={currentRow}
                contractStep={contract.find((item) => item.Name === step) ?? null}
                failure={task.failure?.stepName === step ? task.failure : null}
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
                      onResumed={() => void reload()}
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
