import { useEffect, useRef, useState } from "react"
import { ArrowRight, CheckCircle2, Circle, Loader2, MinusCircle, Play, RefreshCw, RotateCw, Square, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { PendingPanel } from "@/app/pending-panel"
import { DoneBoard } from "@/app/done-board"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  ApiFailure,
  api,
  type Job,
  type Pending,
  type PipelineStep,
  type PluginSummary,
  type RunEntry,
  type RunStepState
} from "@/lib/api"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "mastergo-transcoder-gui.pipeline"
const POLL_MS = 1000

const RUN_STATE_TEXT: Record<string, string> = {
  pending: "等待中",
  running: "运行中",
  done: "已完成",
  failed: "失败",
  stopped: "已停止"
}

const JOB_STATE_TEXT: Record<string, string> = {
  running: "运行中",
  stopping: "正在停止",
  stopped: "已停止",
  done: "已完成",
  failed: "失败"
}

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

function StepIcon({ state }: { state: RunStepState }) {
  if (state === "ok") return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
  if (state === "failed") return <XCircle className="size-4 shrink-0 text-destructive" />
  if (state === "running") return <Loader2 className="size-4 shrink-0 animate-spin" />
  if (state === "skipped") return <MinusCircle className="text-muted-foreground size-4 shrink-0" />
  return <Circle className="text-muted-foreground size-4 shrink-0" />
}

// 停点的步骤不用红叉：它不是在报错，是在等人/AI 补输入。
function WaitingIcon() {
  return <Circle className="size-4 shrink-0 fill-amber-500 text-amber-500" />
}

/*
 * 这一步是不是「等人/AI 补输入」的停点？
 * 判据取自步骤契约自己的 Inputs —— 哪一步吃命名表、哪一步吃译文，插件写在那里，
 * 界面不另写一份步骤名清单。
 */
function needsHumanInput(step: PipelineStep | null, kind: "naming" | "translations"): boolean {
  if (!step) return false;
  const needle = kind === "naming" ? "icon-naming.json" : "lang-translations.json";
  return step.Inputs.some((item) => item.includes(needle));
}

function RunCard({
  run,
  waitingIconNames,
  waitingTranslations,
  onResume,
  resuming,
  running
}: {
  run: RunEntry
  waitingIconNames: number
  waitingTranslations: number
  onResume: () => void
  resuming: boolean
  running: boolean
}) {
  const steps = Object.values(run.steps).sort((left, right) => left.id - right.id)
  const doneCount = steps.filter((step) => step.state === "ok").length
  const failedCount = steps.filter((step) => step.state === "failed").length
  const pendingCount = steps.filter((step) => step.state === "pending").length
  const percent = steps.length === 0 ? 0 : Math.round((doneCount / steps.length) * 100)
  // 进度条按路线状态变色：跑完了绿、失败了红、在跑就是主题色。
  const tone =
    run.state === "failed"
      ? "[&_[data-slot=progress-indicator]]:bg-destructive"
      : run.state === "done"
        ? "[&_[data-slot=progress-indicator]]:bg-emerald-600"
        : ""

  const waitingForInput =
    (waitingIconNames > 0 && needsHumanInput(run.failure?.contract ?? null, "naming")) ||
    (waitingTranslations > 0 && needsHumanInput(run.failure?.contract ?? null, "translations"))

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CardTitle>路线 {run.label}</CardTitle>
            <Badge variant="outline">{run.mode}</Badge>
            <Badge variant={run.state === "failed" ? "destructive" : run.state === "done" ? "secondary" : "outline"}>
              {RUN_STATE_TEXT[run.state] ?? run.state}
            </Badge>
            {run.exitCode !== null && <Badge variant="outline">exit {run.exitCode}</Badge>}
          </div>
          <span className="text-muted-foreground text-sm">
            {doneCount} / {steps.length}
          </span>
        </div>
        <Progress value={percent} className={cn("mt-3 h-1.5", tone)} />
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>完成 {doneCount}</span>
          {failedCount > 0 && <span className="text-destructive">失败 {failedCount}</span>}
          {pendingCount > 0 && <span>未开始 {pendingCount}</span>}
          <span>共 {steps.length}</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol className="flex flex-col gap-1">
          {steps.map((step) => (
            <li
              key={step.id}
              className={cn(
                "flex items-center gap-3 rounded-md px-2 py-1.5",
                step.state === "running" && "bg-muted"
              )}
            >
                    {waitingForInput && step.id === run.failure?.stepId ? <WaitingIcon /> : <StepIcon state={step.state} />}
              <span className="text-muted-foreground w-6 text-right text-xs">{step.id}</span>
              <span className="w-24 shrink-0 font-mono text-xs">{step.name}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{step.title}</span>
              {step.seconds !== null && <span className="text-muted-foreground text-xs">{step.seconds}s</span>}
              {step.note && <span className="text-muted-foreground max-w-64 truncate text-xs">{step.note}</span>}
            </li>
          ))}
        </ol>
        {run.command && (
          <details>
            <summary className="text-muted-foreground cursor-pointer text-xs">完整命令</summary>
            <pre className="bg-muted mt-2 overflow-auto rounded-md p-3 text-xs">{run.command}</pre>
          </details>
        )}
        {run.failure && (
          <Alert variant={waitingForInput ? "default" : "destructive"} className={waitingForInput ? "border-amber-500/60" : undefined}>
            <AlertTitle>
              {waitingForInput
                ? "步骤 " + run.failure.stepId + "（" + run.failure.stepName + "）在等语义输入"
                : run.failure.stepId === 0
                  ? "流水线在进入步骤之前退出"
                  : "步骤 " +
                    run.failure.stepId +
                    (run.failure.stepName ? "（" + run.failure.stepName + "）" : "") +
                    " 失败"}
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              {waitingForInput && (
                <span>
                  报的这句话不是故障，是插件在说「把输入补上再回来」——上面那张卡里列了要补什么。
                </span>
              )}
              <span className="break-all">{run.failure.message}</span>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" disabled={resuming || running} onClick={onResume}>
                  {resuming ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
                  {run.failure.stepId === 0
                    ? "按原参数重跑这一条路线"
                    : "从第 " + run.failure.stepId + " 步（" + run.failure.stepName + "）继续"}
                </Button>
                <span className="text-xs">续跑会继承本次的工程目录、路线、Ui、覆盖与空台账开关</span>
              </div>
              {run.failure.contract && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-medium">这一步可能怎么失败</div>
                    <ul className="mt-1 list-disc pl-4 text-xs">
                      {run.failure.contract.Failures.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-medium">怎么修</div>
                    <ul className="mt-1 list-disc pl-4 text-xs">
                      {run.failure.contract.Recovery.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {run.failure.resume && (
                <div>
                  <div className="text-xs font-medium">修好后从这一步继续</div>
                  <pre className="bg-background/60 mt-1 overflow-auto rounded p-2 text-xs">{run.failure.resume}</pre>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

export function PipelinePage() {
  const [plugin, setPlugin] = useState<PluginSummary | null>(null)
  const [contract, setContract] = useState<PipelineStep[]>([])

  const [link, setLink] = useState("")
  const [projectRoot, setProjectRoot] = useState("")
  const [target, setTarget] = useState("")
  const [ui, setUi] = useState("")
  const [mode, setMode] = useState("B")
  const [stopAfter, setStopAfter] = useState("")
  const [overwrite, setOverwrite] = useState(false)

  const [job, setJob] = useState<Job | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [logText, setLogText] = useState("")
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState("")
  const [automation, setAutomation] = useState("assist")
  const offsetRef = useRef(0)
  const logRef = useRef<HTMLPreElement | null>(null)

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

  useEffect(() => {
    api
      .plugin()
      .then((payload) => {
        setPlugin(payload.plugin)
        setContract(payload.steps)
      })
      .catch((error) => setFailure(error instanceof ApiFailure ? error.message + (error.hint ? "：" + error.hint : "") : String(error)))
    // 刷新后接着看正在跑的这一次
    api
      .runStatus()
      .then((payload) => {
        if (payload.job) setJob(payload.job)
      })
      .catch(() => undefined)
    api
      .settingsGet()
      .then((payload) => setAutomation(payload.settings.automation))
      .catch(() => undefined)
  }, [])

  // 待确认面板续跑之后，把最新的运行状态拉回来（新 job 会替换掉旧的）。
  async function refreshJob() {
    try {
      const payload = await api.runStatus()
      if (payload.job) {
        setLogText("")
        offsetRef.current = 0
        setJob(payload.job)
      }
    } catch {
      /* 拉不到就保持现状 */
    }
  }

  const running = job !== null && (job.state === "running" || job.state === "stopping")

  /*
   * 每次运行停下来后看一眼有没有待确认项。
   * 有，就说明这次停是插件设计的语义判断停点（等人/AI 补输入），不是错误——
   * 界面必须把它和真正的失败分开，否则整条流水线看起来就是"纯脚本执行"。
   */
  useEffect(() => {
    if (!job || running) return
    const { projectRoot, target } = job.request
    if (!projectRoot || !target) {
      setPending(null)
      return
    }
    let stopped = false
    api
      .pending(projectRoot, target)
      .then((payload) => {
        if (!stopped) setPending(payload.pending)
      })
      .catch(() => {
        if (!stopped) setPending(null)
      })
    return () => {
      stopped = true
    }
  }, [job, running])

  const waitingIconNames = pending?.icons.available && pending.icons.needsNaming ? pending.icons.mustName.length : 0
  const waitingTranslations =
    pending?.translations.available && pending.translations.needsTranslation
      ? pending.translations.pendingTranslations.length
      : 0
  const waitingTotal = waitingIconNames + waitingTranslations

  useEffect(() => {
    if (!job || !running) return
    const jobId = job.id
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
  }, [job?.id, running])

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [logText])

  async function start() {
    setFailure("")
    setLogText("")
    offsetRef.current = 0
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ link, projectRoot, target, ui, mode }))
    } catch {
      /* 忽略 */
    }
    try {
      const payload = await api.runStart({ link, projectRoot, target, ui, mode, stopAfter, overwrite })
      setJob(payload.job)
      toast.success("已开始运行")
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message + (error.hint ? "：" + error.hint : "") : String(error))
    }
  }

  async function stop() {
    if (!job) return
    try {
      const payload = await api.runStop(job.id)
      setJob(payload.job)
    } catch (error) {
      toast.error(error instanceof ApiFailure ? error.message : String(error))
    }
  }

  // 从断点继续：后端取这次运行里第一条没跑完的路线，继承原次运行的全部参数。
  async function resume() {
    if (!job) return
    setBusy("resume")
    setFailure("")
    try {
      const payload = await api.runResume(job.id)
      setLogText("")
      offsetRef.current = 0
      setJob(payload.job)
      toast.success(
        "已继续：路线 " + payload.mode + (payload.resumedFrom === "起点" ? "（从起点）" : "（从 " + payload.resumedFrom + "）")
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
          <CardTitle>跑一次转码</CardTitle>
          <CardDescription>
            一次运行只走一条路线；选 AB 会跑两次（先 A 后 B），两条进度独立，互不覆盖。
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
                placeholder="D:\SomeProject —— 产物写进这里，必填"
                value={projectRoot}
                onChange={(event) => setProjectRoot(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="run-target">页面 Target（登记表能命中时可留空）</Label>
              <Input
                id="run-target"
                spellCheck={false}
                placeholder="页面名；多页登记表时必须填一个来选中本次页面"
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
              <Label htmlFor="run-ui">UI 名（可选）</Label>
              <Input id="run-ui" spellCheck={false} value={ui} onChange={(event) => setUi(event.target.value)} />
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
              {running && (
                <Button variant="outline" onClick={() => void stop()}>
                  <Square className="size-4" />
                  停止
                </Button>
              )}
              <Button disabled={running} onClick={() => void start()}>
                <Play className="size-4" />
                开始
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

      {job && (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={job.state === "failed" ? "destructive" : "secondary"}>{JOB_STATE_TEXT[job.state] ?? job.state}</Badge>
          <span className="text-muted-foreground font-mono text-xs">{job.id}</span>
          <span className="text-muted-foreground text-xs">{job.request.mode}</span>
          {job.state !== "done" && job.state !== "running" && job.state !== "stopping" && (
            <Button size="sm" disabled={busy === "resume"} onClick={() => void resume()}>
              {busy === "resume" ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
              从断点继续
            </Button>
          )}
        </div>
      )}

      {waitingTotal > 0 && (
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
                projectRoot={job?.request.projectRoot ?? ""}
                target={job?.request.target ?? ""}
                runId={job?.id ?? ""}
                reloadKey={(job?.id ?? "") + ":" + (job?.state ?? "")}
                automation={automation}
                onResumed={() => void refreshJob()}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {job?.runs.map((run) => (
        <RunCard
          key={run.mode}
          run={run}
          waitingIconNames={waitingIconNames}
          waitingTranslations={waitingTranslations}
          resuming={busy === "resume"}
          running={running}
          onResume={() => void resume()}
        />
      ))}

      {job && job.state === "done" && (
        <DoneBoard projectRoot={job.request.projectRoot} target={job.request.target} />
      )}

      {job && (
        <Card>
          <CardHeader>
            <CardTitle>运行日志</CardTitle>
            <CardDescription>来自 run-all.ps1 的实时输出；每步的完整日志另存在 Generated\_work\steps\ 下。</CardDescription>
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
