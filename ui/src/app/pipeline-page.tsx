import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Circle, Loader2, MinusCircle, Play, RefreshCw, Square, XCircle } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ApiFailure, api, type Job, type PipelineStep, type PluginSummary, type RunEntry, type RunStepState } from "@/lib/api"
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

function StepIcon({ state }: { state: RunStepState }) {
  if (state === "ok") return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
  if (state === "failed") return <XCircle className="size-4 shrink-0 text-destructive" />
  if (state === "running") return <Loader2 className="size-4 shrink-0 animate-spin" />
  if (state === "skipped") return <MinusCircle className="text-muted-foreground size-4 shrink-0" />
  return <Circle className="text-muted-foreground size-4 shrink-0" />
}

function RunCard({ run }: { run: RunEntry }) {
  const steps = Object.values(run.steps).sort((left, right) => left.id - right.id)
  const doneCount = steps.filter((step) => step.state === "ok").length
  const percent = steps.length === 0 ? 0 : Math.round((doneCount / steps.length) * 100)

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
        <Progress value={percent} className="mt-3" />
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
              <StepIcon state={step.state} />
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
          <Alert variant="destructive">
            <AlertTitle>
              {run.failure.stepId === 0
                ? "流水线在进入步骤之前退出"
                : "步骤 " +
                  run.failure.stepId +
                  (run.failure.stepName ? "（" + run.failure.stepName + "）" : "") +
                  " 失败"}
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span className="break-all">{run.failure.message}</span>
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
  const [logText, setLogText] = useState("")
  const [failure, setFailure] = useState("")
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
  }, [])

  const running = job !== null && (job.state === "running" || job.state === "stopping")

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
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="B">B —— MTSLG IOContorl 页面 XML（缺省）</SelectItem>
                  <SelectItem value="A">A —— MW WPF XAML 页面</SelectItem>
                  <SelectItem value="AB">AB —— 两条都跑（两次运行）</SelectItem>
                </SelectContent>
              </Select>
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
        <div className="flex items-center gap-3">
          <Badge variant={job.state === "failed" ? "destructive" : "secondary"}>{JOB_STATE_TEXT[job.state] ?? job.state}</Badge>
          <span className="text-muted-foreground font-mono text-xs">{job.id}</span>
          <span className="text-muted-foreground text-xs">{job.request.mode}</span>
        </div>
      )}

      {job?.runs.map((run) => (
        <RunCard key={run.mode} run={run} />
      ))}

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
