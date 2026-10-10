/*
 * 流水线页：两屏 —— 新建任务（表单）与任务详情。
 *
 *   新建：`#pipeline`（侧边栏「+ 新建任务」进来）→ NewTaskCard。
 *   详情：`#pipeline?task=<id>`（看板点「详情」、或刚加入看板）→ 左边步骤条 + 右边当前那一步的界面。
 *
 * 本文件只做编排与接线：看板快照在 use-board-tasks，待确认清单在 use-pending，
 * 动作在 use-task-actions，开始前的身份决定在 ui/src/lib/task-start.ts，步骤条的数据映射在
 * ui/src/lib/step-rows.ts，身份补全在 use-identity，运行日志在 use-run-log。每个面板自己知道自己要什么。
 */

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
import { ClampText } from "@/app/clamp-text"
import { useBoardTasks } from "@/app/use-board-tasks"
import { useIdentity } from "@/app/use-identity"
import { usePending } from "@/app/use-pending"
import { useRunLog } from "@/app/use-run-log"
import { useTaskActions } from "@/app/use-task-actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { api, type PipelineStep, type PluginSummary } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { candidatesForLink } from "@/lib/identity-flow"
import { stepRowOf, stepRowsOf } from "@/lib/step-rows"
import { AUTOMATION_LABEL, readTaskForm, writeTaskForm, type TaskForm } from "@/lib/task-form"
import { decideStartIdentity } from "@/lib/task-start"
import { canStop, hasProducts, isBusyState, pendingInputCount, waitingCounts } from "@/lib/task-state"
import { fileToBase64 } from "@/lib/upload-files"

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
  /** 新建时先选好的设计稿位图：只是这一份文件，等任务跑到「取数 + 固化快照」之后再暂存/核对落地。 */
  const [stagedImage, setStagedImage] = useState<{ name: string; bytes: number; file: File } | null>(null)
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
    const decision = await decideStartIdentity({
      link: form.link,
      projectRoot: form.projectRoot,
      target: form.target,
      ui: form.ui,
      automation,
      loadCandidates: async () =>
        (
          await candidatesForLink({
            link: form.link,
            projectRoot: form.projectRoot,
            pageName: identity.name,
            ui: form.ui,
            useAi: false
          })
        ).items,
      autoPick: () => identity.pick(),
      autoApply: (item) => identity.apply(item)
    })
    if (!decision.ok) {
      if (decision.reason) setFailure(decision.reason)
      return
    }
    /*
     * 先选好的位图在这里暂存（那时画板尺寸还不知道，核不了尺寸）：任务跑到「取数 + 固化快照」之后
     * 由看板那侧核对尺寸再落地。图不合规（不是 PNG/JPEG、太大）按后端原话拦下，不建任务。
     */
    if (stagedImage) {
      try {
        await api.stageDesignImage({
          projectRoot: form.projectRoot,
          target: decision.target,
          data: await fileToBase64(stagedImage.file)
        })
      } catch (error) {
        setFailure(describeFailure(error))
        return
      }
    }
    try {
      const added = await actions.start({
        projectRoot: form.projectRoot,
        ui: decision.ui,
        autoMerge: true,
        stopAfter: form.stopAfter,
        overwrite: form.overwrite,
        items: [{ link: form.link, target: decision.target, mode: form.mode as "A" | "B" | "AB" }]
      })
      const created = added.created[0] ?? ""
      await actions.startJob(created)
      setCurrentId(created)
      setStagedImage(null)
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
          stagedImage={stagedImage ? { name: stagedImage.name, bytes: stagedImage.bytes } : null}
          onPickImage={(file) => setStagedImage(file ? { name: file.name, bytes: file.size, file: file } : null)}
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
            {/* 动作的失败只有一个出口（use-task-actions 的 onFailure）：这一屏也得看得见，不能只在表单那屏显示。 */}
            {failure && (
              <Alert variant="destructive">
                <AlertTitle>这一步没做成</AlertTitle>
                <AlertDescription>
                  <ClampText text={failure} />
                </AlertDescription>
              </Alert>
            )}
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
                  图与分组表都属于「布局」那一步的输入；那一步叫什么由后端按插件契约的 Inputs 算出来
                  （task.layoutStep），界面不认步骤名。它们就挂在这一步的界面里。
                */}
                {step !== "" && step === task.layoutStep && task.workDir && task.request.target && task.routes.includes("A") && (
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
                      state={task.state}
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
                      state={task.state}
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
