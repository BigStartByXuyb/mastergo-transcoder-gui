/*
 * 流水线页：两屏 —— 新建任务（表单）与任务详情。
 *
 *   新建：`#pipeline`（侧边栏「+ 新建任务」进来）→ NewTaskCard。
 *   详情：`#pipeline?task=<id>`（看板点「详情」、或刚加入看板）→ 左边步骤条 + 右边当前那一步的界面。
 *
 * 本文件只做编排与接线：看板快照在 use-board-tasks，待确认清单由面板自己取（app/pending-panel.tsx），
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
import { useRunLog } from "@/app/use-run-log"
import { useTaskActions } from "@/app/use-task-actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { api, type PipelineStep, type PluginSummary } from "@/lib/api"
import { keepPickedImages, pickedForLink, withPickedImage } from "@/lib/board-items"
import { describeFailure } from "@/lib/describe-failure"
import { candidatesForLink } from "@/lib/identity-flow"
import { stepRowOf, stepRowsOf } from "@/lib/step-rows"
import { stagePickedImages } from "@/app/stage-design-images"
import { AUTOMATION_LABEL, readTaskForm, writeTaskForm, type TaskForm } from "@/lib/task-form"
import { decideStartIdentity } from "@/lib/task-start"
import { canStop, hasProducts } from "@/lib/task-state"

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
   * 新建时先选好的设计稿位图：按链接记，与看板同一套（ui/src/lib/board-items.ts）——
   * 还没填链接时选的那一份先记在「待认领」那一格，链接一填就归这一页；换成另一页就不算数。
   */
  const [images, setImages] = useState<Record<string, File>>({})
  const stagedImage = pickedForLink(images, form.link)
  /*
   * 两屏：带 `task=<id>`（从看板点「详情」、或刚「加入看板并开始」）就是看那个任务；
   * 不带（侧边栏「+ 新建任务」）就是新建表单。换屏走侧边栏/看板，页内不放互相跳的按钮。
   * 给哪一屏由「有没有这条路由 + 快照里有没有这个任务」唯一决定（不另存一份状态）。
   */
  const { setBoard, reload, taskOf } = useBoardTasks()
  const task = taskOf(currentId)
  /* 给哪一屏：见上面「两屏」那段 —— 没有路由里的任务 id，或快照里已经没有这个任务，就给表单。 */
  const showForm = !taskId || !task
  const showProducts = task !== null && hasProducts(task.state)
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
    const link = patch.link
    if (link !== undefined && link !== form.link) setImages((current) => keepPickedImages(current, link))
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
    if (taskId) setCurrentId(taskId)
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
    // 失败时动作返回 null，原话已经由 use-task-actions 写进 failure：这一次点击到这儿就收尾。
    const added = await actions.start({
      projectRoot: form.projectRoot,
      ui: decision.ui,
      autoMerge: true,
      stopAfter: form.stopAfter,
      overwrite: form.overwrite,
      items: [{ link: form.link, target: decision.target, mode: form.mode as "A" | "B" | "AB" }]
    })
    if (!added) return
    // 后端建不出来就不会回成功（lib/board.js 的 add 在没解析出链接时直接抛），所以这里一定有这一条。
    const created = added.created[0]
    await actions.startJob(created)
    setCurrentId(created)
    /*
     * 先选好的位图跟着任务暂存（暂存件的键是任务 id）：那时画板尺寸还不知道，核不了尺寸 ——
     * 任务跑到「取数 + 固化快照」之后由看板那侧核对尺寸再落地。
     * 图被后端挡回来（不是 PNG/JPEG、太大）弹一句原话 + 后果，与看板那条同源：任务已经建好并在跑，
     * 不占表单上的「启动失败」（那不是启动没成）。
     */
    if (stagedImage) {
      // 门禁、逐张送、失败怎么说都在 ui/src/app/stage-design-images.ts（与看板那条同源）。
      await stagePickedImages(form.mode, [{ taskId: created, file: stagedImage }])
    }
    setImages({})
    window.location.hash = "pipeline?task=" + created
    toast.success("已加入看板并开始")
  }

  const failedStep = contract.find((item) => item.Name === stopStep) ?? null
  const allStepsDone = stepRows.length > 0 && stepRows.every((row) => row.status === "ok" || row.status === "skipped")

  return (
    <div className="flex w-full flex-col gap-4">
      {/* 表单与详情是两屏；没有选中任务时（任务被移除 / 只是进来看看）一定给表单。 */}
      {showForm && (
        <NewTaskCard
          form={form}
          onForm={patchForm}
          plugin={plugin}
          contract={contract}
          identity={identity}
          image={stagedImage}
          onPickImage={(file) => setImages((current) => withPickedImage(current, form.link, file))}
          busy={actions.busy}
          failure={failure}
          canStop={task !== null && canStop(task.state)}
          onStart={() => void start()}
          onStop={() => task && void actions.stop(task)}
          onReloadContract={() => void actions.reloadContract()}
        />
      )}

      {showForm && task && (
        <p className="text-muted-foreground text-sm">
          上面填好点「加入看板并开始」，或在看板点某个任务的「详情」——那是另一屏，按步骤看。
        </p>
      )}

      {/*
        详情按「步骤条 + 当前那一步的界面」摆：左边一条（点一步切过去），右边只显示那一步的东西，
        不再把每步的输入挤在一屏里。停在哪一步就自动切到那一步。
      */}
      {!showForm && task && (
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
                {step === task.layoutStep && task.workDir && task.request.target && task.routes.includes("A") && (
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

                {/*
                  图标与文案要人补时，面板挂在「停在这里」的那一步上（补完就从这一步继续）。
                  「有没有要补的」不在这边另取一次清单：任务停在语义停点（waiting）就是后端的结论
                  （lib/board.js 的 isSemanticStop，判据只那一处）；清单本身由面板自己取一次。
                */}
                {step === stopStep && task.state === "waiting" && task.workDir && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground text-xs">
                        {/* 只报这一层级的名字：每层什么意思、布局确认那一节怎么另算，都在设置 → AI Agent 那一处说。 */}
                        当前自动化层级：{AUTOMATION_LABEL[automation] ?? automation}
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
