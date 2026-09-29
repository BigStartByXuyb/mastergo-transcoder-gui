import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, GitMerge, Loader2, Play, RefreshCw, RotateCw, Sparkles, Square } from "lucide-react"
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
  type IdentityCandidate,
  type Job,
  type Pending,
  type PipelineStep,
  type PluginSummary,
  type ProjectPages
} from "@/lib/api"
import { readStored, writeStored } from "@/lib/storage"
import { boardStateVariant } from "@/lib/board-state"

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
  const [pages, setPages] = useState<ProjectPages | null>(null)
  const [previewUi, setPreviewUi] = useState("")
  const [identityName, setIdentityName] = useState("")
  const [identityCandidates, setIdentityCandidates] = useState<IdentityCandidate[]>([])
  const [identityBusy, setIdentityBusy] = useState("")

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
    const saved = readStored(STORAGE_KEY, { link: "", projectRoot: "", target: "", ui: "", mode: "" }, (raw) => ({
      link: String(raw.link ?? ""),
      projectRoot: String(raw.projectRoot ?? ""),
      target: String(raw.target ?? ""),
      ui: String(raw.ui ?? ""),
      mode: String(raw.mode ?? "")
    }))
    if (saved.link) setLink(saved.link)
    if (saved.projectRoot) setProjectRoot(saved.projectRoot)
    if (saved.target) setTarget(saved.target)
    if (saved.ui) setUi(saved.ui)
    if (saved.mode) setMode(saved.mode)
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

  /*
   * 登记表与「Target → 区域」预览是两件独立的事，分两条取值路径：
   *   · 候选页面列表只跟工程目录有关；
   *   · 预览只跟 Target 有关（后端算，前端不持规则），工程目录空着也要能显示。
   * 之前把两者塞进同一个 effect，会因为「目录为空就提前 return」让预览停留在上一次的值，
   * 提示就会说反话（能推的说推不出来、推不出来的说成会推出）。
   */
  function loadPages(root: string) {
    if (!root) {
      setPages(null)
      return
    }
    api
      .projectPages(root)
      .then((payload) => setPages(payload.pages))
      .catch(() => setPages(null))
  }

  function loadPreview(nextTarget: string) {
    api
      .identityPrefix(nextTarget)
      .then((payload) => setPreviewUi(payload.previewUi))
      .catch(() => setPreviewUi(""))
  }

  useEffect(() => {
    const root = projectRoot.trim()
    const timer = window.setTimeout(() => loadPages(root), 600)
    return () => window.clearTimeout(timer)
  }, [projectRoot])

  useEffect(() => {
    const next = target.trim()
    if (!next) {
      setPreviewUi("")
      return
    }
    const timer = window.setTimeout(() => loadPreview(next), 600)
    return () => window.clearTimeout(timer)
  }, [target])

  const derivedUi = ui.trim() ? "" : previewUi
  const needsIdentityHint = !ui.trim() && !target.trim()
  // 填了 Target 但仍推不出区域：这是最容易被误判成「插件坏了」的情况，必须提前说清原因。
  const targetWithoutPrefix = !ui.trim() && Boolean(target.trim()) && !derivedUi

  /*
   * 页面身份补全：和插件跑法里 agent 做的是同一件事——按设计页名与项目既有区域约定给出
   * 「Target + 区域」候选，写进工程登记表，再回填表单。
   * 自动化层级是 auto 时直接采用第一条（不人工确认）；assist/off 时列出来等人点。
   */
  async function fillIdentity() {
    setIdentityBusy("candidates")
    setFailure("")
    try {
      const payload = await api.identityCandidates({
        projectRoot: projectRoot.trim(),
        pageName: identityName.trim() || target.trim(),
        useAi: automation !== "off"
      })
      const list: IdentityCandidate[] = [
        ...(payload.ai.items ?? []),
        ...(payload.candidates ?? [])
      ]
      setIdentityCandidates(list)
      if (list.length === 0) {
        setFailure("这个工程里还没有任何区域约定（登记表里没有页面、也没有带前缀的 Target），先手工填一次 Ui 前缀，之后就能自动补了。")
        return
      }
      if (automation === "auto") {
        const first = list.find((item) => item.target && !item.needsSemanticName) ?? list.find((item) => item.target)
        if (first) await applyIdentity(first)
        else setFailure("候选里还没有拼好的 Target，需要先给语义名（或把自动化层级降到辅助，手工确认一次）。")
      }
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message + (error.hint ? "：" + error.hint : "") : String(error))
    } finally {
      setIdentityBusy("")
    }
  }

  async function applyIdentity(item: IdentityCandidate) {
    if (!item.target || !item.ui) return
    setIdentityBusy("apply")
    try {
      const written = await api.identityApply({
        projectRoot: projectRoot.trim(),
        target: item.target,
        ui: item.ui,
        designPageName: identityName.trim() || target.trim()
      })
      setTarget(item.target)
      setUi(item.ui)
      toast.success("已写入登记表（" + (written.replaced ? "替换" : "新增") + "）：" + item.target + " · UI " + item.ui)
      setIdentityCandidates([])
      loadPages(projectRoot.trim())
      // 预览不用在这里再取一次：setTarget 会让上面那条 effect 跑（同一件事只有一个入口）。
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message + (error.hint ? "：" + error.hint : "") : String(error))
    } finally {
      setIdentityBusy("")
    }
  }

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
    writeStored(STORAGE_KEY, { link, projectRoot, target, ui, mode })
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

          {/* Target / UI 的去向提示：说明「谁来决定区域」，并给出登记表里的候选与推导预览。 */}
          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="run-identity-name"
                className="h-8 max-w-xs"
                spellCheck={false}
                placeholder="设计页名（可选，如 Manual Align）"
                value={identityName}
                onChange={(event) => setIdentityName(event.target.value)}
              />
              <Button size="sm" variant="outline" disabled={identityBusy !== ""} onClick={() => void fillIdentity()}>
                {identityBusy === "candidates" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                自动补 Target / 区域
              </Button>
              <span>
                按项目既有区域约定 + 设计页名给出候选并写进工程登记表；
                当前自动化层级：
                {AUTOMATION_LABEL[automation] ?? automation}
                {automation === "auto" ? "（直接采用第一条，不人工确认）" : "（列出来，你点一下再写）"}
              </span>
            </div>
            {identityCandidates.length > 0 && (
              <div className="flex flex-col gap-1">
                {identityCandidates.map((item, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={item.target ? "default" : "outline"}
                      disabled={!item.target || identityBusy !== ""}
                      onClick={() => void applyIdentity(item)}
                    >
                      {item.target || "（还需要语义名）"}
                    </Button>
                    <span>
                      {item.ui ? "UI " + item.ui + " · " : ""}
                      {item.basis}
                      {typeof item.confidence === "number" ? " · 置信度 " + item.confidence : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {derivedUi && <span>将使用 UI={derivedUi}（按 Target 前缀推导；插件自己也会这么算）</span>}
            {needsIdentityHint && (
              <span className="text-amber-600">
                UI 与 Target 都空：插件会按取值链解析（登记表 → Target 前缀/首词）；都取不到就会在入口停下。
                最省事的做法是把 Target 写成带区域前缀的形式，例如 F3Align。
              </span>
            )}
            {targetWithoutPrefix && (
              <span className="text-amber-600">
                Target「{target.trim()}」推不出区域前缀：插件只认两种形状——带编号前缀（F3Align → F3）或
                大写开头的首词（HomeContent → Home）。当前这个写成小写/下划线，两条都不命中。
                要么把 UI 区域显式填上，要么把 Target 改成 F3{target.trim()}（或用 PascalCase 如 TestMastergp）。
              </span>
            )}
            {pages && !pages.exists && <span>{pages.problem}</span>}
            {pages && pages.exists && pages.pages.length === 0 && <span>登记表里还没有可用的页面条目。</span>}
            {pages && pages.exists && pages.pages.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span>登记表里登记的页面（点一下填上 Target；条目里写了 Ui 就连 Ui 一起填）：</span>
                {pages.pages.map((page, index) => (
                  <Button
                    key={page.target + index}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (page.target) setTarget(page.target)
                      // 登记表条目没写 ui 时也照实留空：区域由插件按 Target 前缀自己推，前端不替它算。
                      setUi(page.ui)
                    }}
                  >
                    {page.target || page.layerId}
                    {page.ui ? "（UI " + page.ui + "）" : ""}
                  </Button>
                ))}
              </div>
            )}
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
              <Badge variant={boardStateVariant(task.state)}>
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
