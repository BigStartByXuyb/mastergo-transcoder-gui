import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, GitMerge, Loader2, Play, RefreshCw, RotateCw, Square } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { DoneBoard } from "@/app/done-board"
import { PendingPanel } from "@/app/pending-panel"
import { StepFlow } from "@/app/task-steps"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  ApiFailure,
  api,
  type Board,
  type Job,
  type Pending,
  type PipelineStep,
  type PluginSummary
} from "@/lib/api"

/*
 * 流水线：新建任务 + 看某个任务的详情。
 *
 * 任务只有一套登记（看板）：这里「开始」等于「加入看板并启动」，看板的「详情」跳到这里，
 * 两边看的是同一个任务的同一份步骤登记。执行引擎、工作目录、并发与合并都在后端做。
 */

const STORAGE_KEY = "mastergo-transcoder-gui.pipeline"
const POLL_MS = 1500

// 下拉框里只显示短值，长说明放下面一行：否则触发按钮的宽度会随选中项变化，
// 弹层每次重新定位，看起来像"选一下就跳位置"。
const MODE_HINT: Record<string, string> = {
  B: "B —— MTSLG IOContorl 页面 XML（缺省）",
  A: "A —— MW WPF XAML 页面",
  AB: "AB —— 两条都跑，两次独立运行（先 A 后 B）"
}

const AUTOMATION_LABEL: Record<string, string> = {
  off: "关（不叫模型）",
  assist: "辅助",
  auto: "自动"
}

// 占着执行额度的状态：这些状态下不允许再起同一个任务，也显示「停止」。
const BUSY_STATES = ["preparing", "running", "merging"]

export function PipelinePage({ taskId }: { taskId: string }) {
  const [plugin, setPlugin] = useState<PluginSummary | null>(null)
  const [contract, setContract] = useState<PipelineStep[]>([])
  const [board, setBoard] = useState<Board | null>(null)
  const [currentId, setCurrentId] = useState(taskId)
  const [job, setJob] = useState<Job | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [logText, setLogText] = useState("")
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState("")
  const [automation, setAutomation] = useState("assist")

  const [link, setLink] = useState("")
  const [projectRoot, setProjectRoot] = useState("")
  const [target, setTarget] = useState("")
  const [ui, setUi] = useState("")
  const [mode, setMode] = useState("B")
  const [stopAfter, setStopAfter] = useState("")
  const [overwrite, setOverwrite] = useState(false)

  const offsetRef = useRef(0)
  const logRef = useRef<HTMLPreElement | null>(null)

  const task = useMemo(
    () => (board?.tasks ?? []).find((item) => item.id === currentId) ?? null,
    [board, currentId]
  )
  const stepTitles = useMemo(() => {
    const map = new Map<string, string>()
    for (const step of contract) map.set(step.Name, step.Title)
    return map
  }, [contract])
  const running = task !== null && BUSY_STATES.includes(task.state)
  const finished = task !== null && ["ready", "merging", "merged", "conflict"].includes(task.state)
  const contractStep = task?.failure ? contract.find((step) => step.Name === task.failure?.stepName) ?? null : null

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")
      if (saved.link) setLink(String(saved.link))
      if (saved.projectRoot) setProjectRoot(String(saved.projectRoot))
      if (saved.target) setTarget(String(saved.target))
      if (saved.ui) setUi(String(saved.ui))
      if (saved.mode) setMode(String(saved.mode))
    } catch {
      /* 存储不可用就忽略 */
    }
  }, [])

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
      .catch((error) =>
        setFailure(error instanceof ApiFailure ? error.message + (error.hint ? "：" + error.hint : "") : String(error))
      )
    api
      .settingsGet()
      .then((payload) => setAutomation(payload.settings.automation))
      .catch(() => undefined)
  }, [])

  // 从看板点「详情」进来时 URL 带 task=<id>：跟着它切换当前任务。
  useEffect(() => {
    if (taskId) setCurrentId(taskId)
  }, [taskId])

  // 换任务、或这次任务换了运行（续跑会起新运行）时，日志从头发。
  const jobId = task?.jobId ?? ""
  useEffect(() => {
    setLogText("")
    offsetRef.current = 0
    if (!jobId) {
      setJob(null)
      return
    }
    let alive = true
    api
      .runStatus(jobId)
      .then((payload) => {
        if (alive) setJob(payload.job)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [jobId])

  const runLive = job !== null && (job.state === "running" || job.state === "stopping")

  useEffect(() => {
    if (!jobId || !runLive) return
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const status = await api.runStatus(jobId)
          if (status.job) setJob(status.job)
          const slice = await api.runLog(jobId, offsetRef.current)
          if (slice.truncated) setLogText(slice.text)
          else if (slice.text) setLogText((current) => current + slice.text)
          offsetRef.current = slice.next
        } catch {
          /* 轮询失败不打断界面 */
        }
      })()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [jobId, runLive])

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [logText])

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

  const waitingIconNames = pending?.icons.available && pending.icons.needsNaming ? pending.icons.mustName.length : 0
  const waitingTranslations =
    pending?.translations.available && pending.translations.needsTranslation
      ? pending.translations.pendingTranslations.length
      : 0
  const waitingTotal = waitingIconNames + waitingTranslations

  // 开始 = 新建看板任务 + 启动它；看板负责建工作目录、并发与合并。
  async function start() {
    setFailure("")
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ link, projectRoot, target, ui, mode }))
    } catch {
      /* 忽略 */
    }
    setBusy("start")
    try {
      const added = await api.boardAdd({
        projectRoot,
        ui,
        autoMerge: true,
        stopAfter,
        overwrite,
        items: [{ link, target, mode: mode as "A" | "B" | "AB" }]
      })
      const created = added.created[0] ?? ""
      await api.boardStart(created)
      setBoard(added.board)
      setCurrentId(created)
      window.location.hash = "pipeline?task=" + created
      toast.success("已加入看板并开始")
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message + (error.hint ? "：" + error.hint : "") : String(error))
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
      toast.error(error instanceof ApiFailure ? error.message : String(error))
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
      setLogText("")
      offsetRef.current = 0
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
      setFailure(error instanceof ApiFailure ? error.message + (error.hint ? "：" + error.hint : "") : String(error))
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
      toast.error(error instanceof ApiFailure ? error.message : String(error))
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>新建转码任务</CardTitle>
          <CardDescription>
            一次任务只走一条路线；选 AB 会跑两次（先 A 后 B），两条进度独立，互不覆盖。任务会进看板，
            有自己的工作目录，跑完自动合并回工程。
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {plugin && <Badge variant="outline">插件 {plugin.version ? "v" + plugin.version : "未知版本"}</Badge>}
            {plugin && <Badge variant="secondary">共 {contract.length} 步</Badge>}
            {plugin && !plugin.runAllExists && <Badge variant="destructive">缺 run-all.ps1</Badge>}
            <Button variant="outline" size="sm" onClick={() => void reloadContract()}>
              <RefreshCw className="size-4" />
              重读契约
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="run-link">MasterGo 链接（页面帧或容器）</Label>
            <Input
              id="run-link"
              spellCheck={false}
              placeholder="https://mastergo.com/goto/xxxx?file=...&layer_id=..."
              value={link}
              onChange={(event) => setLink(event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="run-project">工程目录</Label>
              <Input
                id="run-project"
                spellCheck={false}
                placeholder="工程目录的绝对路径 —— 产物合并回这里，必填"
                value={projectRoot}
                onChange={(event) => setProjectRoot(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="run-target">页面 Target</Label>
              <Input
                id="run-target"
                spellCheck={false}
                placeholder="页面名 —— 产物文件名与 UI 区域都按它算"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>路线</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="w-24">
                  <SelectValue>{mode}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="B">B —— MTSLG IOContorl 页面 XML</SelectItem>
                  <SelectItem value="A">A —— MW WPF XAML 页面</SelectItem>
                  <SelectItem value="AB">AB —— 两条都跑</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{MODE_HINT[mode] ?? ""}</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="run-ui">UI 区域（可选）</Label>
              <Input
                id="run-ui"
                spellCheck={false}
                placeholder="F3 —— 登记表没登记时才要填"
                value={ui}
                onChange={(event) => setUi(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="run-stop">停在某一步（可选）</Label>
              <Input
                id="run-stop"
                spellCheck={false}
                placeholder="例如 discover —— 先出待命名清单"
                value={stopAfter}
                onChange={(event) => setStopAfter(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="run-overwrite" checked={overwrite} onCheckedChange={setOverwrite} />
              <Label htmlFor="run-overwrite">替换已有产物（默认不替换，同名就停）</Label>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {task && running && (
                <Button variant="outline" disabled={busy !== ""} onClick={() => void stop()}>
                  <Square className="size-4" />
                  停止
                </Button>
              )}
              <Button disabled={busy !== ""} onClick={() => void start()}>
                {busy === "start" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                加入看板并开始
              </Button>
            </div>
          </div>

          {failure && (
            <Alert variant="destructive">
              <AlertTitle>启动失败</AlertTitle>
              <AlertDescription className="break-all">{failure}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {!task && (
        <p className="text-muted-foreground text-sm">还没有选中的任务。上面填好点「加入看板并开始」，或在看板点某个任务的「详情」。</p>
      )}

      {task && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              任务详情
              <Badge variant={task.state === "failed" || task.state === "conflict" ? "destructive" : "secondary"}>
                {task.stateLabel}
              </Badge>
              <Badge variant="outline">{task.request.mode}</Badge>
              {task.request.target && <Badge variant="outline">Target {task.request.target}</Badge>}
              {task.request.ui && <Badge variant="outline">UI {task.request.ui}</Badge>}
              {task.request.stopAfter && <Badge variant="outline">停在 {task.request.stopAfter}</Badge>}
            </CardTitle>
            <CardDescription className="break-all">
              工作目录 {task.workDir || "（还没建）"}
              {task.request.projectRoot ? " · 合并回 " + task.request.projectRoot : ""}
            </CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {task.state !== "running" && task.state !== "merging" && task.jobId && (
                <Button size="sm" disabled={busy === "resume"} onClick={() => void resume()}>
                  {busy === "resume" ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
                  从断点继续
                </Button>
              )}
              {(task.state === "ready" || task.state === "conflict") && (
                <Button
                  size="sm"
                  disabled={busy !== ""}
                  onClick={() => {
                    setBusy("merge")
                    api
                      .boardMerge(task.id)
                      .then((payload) => setBoard(payload.board))
                      .catch((error) => toast.error(error instanceof ApiFailure ? error.message : String(error)))
                      .finally(() => setBusy(""))
                  }}
                >
                  <GitMerge className="size-4" />
                  {task.state === "conflict" ? "重新合并" : "合并回工程"}
                </Button>
              )}
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
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {task.failure && (
              <Alert variant={task.failure.kind === "error" ? "destructive" : "default"}>
                <AlertTitle>
                  {task.failure.kind === "error"
                    ? "失败：" + (task.failure.title || task.failure.stepName)
                    : "停在语义判断点，不是错误：" + (task.failure.title || task.failure.stepName)}
                </AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  {task.failure.message && <p className="break-all">{task.failure.message}</p>}
                  {task.failure.logPath && (
                    <p className="text-muted-foreground break-all text-xs">这一步的日志：{task.failure.logPath}</p>
                  )}
                  {contractStep && (
                    <>
                      <div>
                        <div className="text-xs font-medium">可能的原因</div>
                        <ul className="list-disc pl-5 text-xs">
                          {contractStep.Failures.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-medium">修好后怎么继续</div>
                        <ul className="list-disc pl-5 text-xs">
                          {contractStep.Recovery.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}
            <StepFlow task={task} stepTitles={stepTitles} />
          </CardContent>
        </Card>
      )}

      {task && waitingTotal > 0 && (
        <Card className="border-amber-500/60">
          <CardHeader>
            <CardTitle>等待语义输入 —— 这不是错误</CardTitle>
            <CardDescription>
              流水线按设计停在这里。「要不要登记」由插件机械判定；「叫什么名字、怎么翻译」才是语义判断，
              只能由人或 AI 给——这几步永远绕不过去。补完从断点继续。
            </CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {waitingIconNames > 0 && <Badge variant="secondary">图标定名 {waitingIconNames} 条</Badge>}
              {waitingTranslations > 0 && <Badge variant="secondary">文案译文 {waitingTranslations} 条</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    window.location.hash = "review"
                  }}
                >
                  <ArrowRight className="size-4" />
                  在独立页面打开
                </Button>
                <span className="text-muted-foreground text-xs">
                  当前自动化层级：{AUTOMATION_LABEL[automation] ?? automation}
                  {automation === "assist" ? "（AI 自动出候选，你确认后继续）" : ""}
                  {automation === "auto" ? "（AI 自动出候选并直接继续）" : ""}
                  {automation === "off" ? "（不叫模型，全人工填）" : ""}
                </span>
              </div>
              <PendingPanel
                projectRoot={task.workDir}
                target={task.request.target}
                runId={task.jobId}
                reloadKey={task.id + ":" + task.updatedAt}
                automation={automation}
                onResumed={() => {
                  void api
                    .board()
                    .then((payload) => setBoard(payload.board))
                    .catch(() => undefined)
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {task && finished && task.workDir && (
        <DoneBoard projectRoot={task.workDir} target={task.request.target} />
      )}

      {task && job && (
        <Card>
          <CardHeader>
            <CardTitle>运行日志</CardTitle>
            <CardDescription>来自 run-all.ps1 的实时输出；每步的完整日志另存在工作目录的 Generated\_work\steps\ 下。</CardDescription>
          </CardHeader>
          <CardContent>
            <pre ref={logRef} className="bg-muted max-h-96 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {logText || "（暂无输出）"}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
