import { useEffect, useRef, useState } from "react"
import { Loader2, Send, Square } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClampText } from "@/app/clamp-text"
import { ChatTranscript, type Turn } from "@/app/chat-transcript"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { agentChatStream, api, type Settings } from "@/lib/api"
import { readCodexLine, type AgentItem } from "@/lib/agent-stream"
import { describeFailure } from "@/lib/describe-failure"
import { readRecentProjects, rememberProject } from "@/lib/recent-projects"

/*
 * 对话页：一次提问就是一次 codex exec，回答、命令、命令输出都按顺序贴在下面。
 * 续跑认 thread id（codex exec resume），所以同一个对话能接着上一次继续说。
 *
 * 写盘默认关：关着时 Codex 只读；开着且这里也勾了，才允许它直接改工程文件。
 * 引擎日志按轮收尾：正常跑完的 stderr 有「Reading additional input from stdin」这类噪音，
 * 默认收着；收尾不干净（收到失败事件或退出码非 0）才自动铺开，让人一眼看到真正的原因。
 *
 * 一红就是真没跑完：只有传输失败、turn.failed、退出码非 0、退出码 0 却没收尾（且不是人点停下）才出红卡；
 * 引擎中途报的重试一类消息走浅色提示，等收尾再定性。
 */
export function ChatPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [projectRoot, setProjectRoot] = useState(() => readRecentProjects()[0] ?? "")
  const [prompt, setPrompt] = useState("")
  const [write, setWrite] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [engine, setEngine] = useState("")
  const [thread, setThread] = useState("")
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const failedRef = useRef(false)
  const stderrRef = useRef("")
  const turnDoneRef = useRef(false)
  const stoppedRef = useRef(false)

  useEffect(() => {
    api
      .settingsGet()
      .then((payload) => setSettings(payload.settings))
      .catch((error) => setFailure(describeFailure(error)))
  }, [])

  const allowWrite = Boolean(settings?.agent.allowWrite)

  function push(item: AgentItem) {
    setTurns((current) => [...current, { kind: "agent", item }])
  }

  function flushEngineLog() {
    const text = stderrRef.current.replace(/\n+$/, "")
    stderrRef.current = ""
    if (!text) return
    setTurns((current) => [...current, { kind: "log", text, open: failedRef.current }])
  }

  async function send() {
    const text = prompt.trim()
    if (!text || running) return
    setTurns((current) => [...current, { kind: "you", text }])
    setPrompt("")
    stderrRef.current = ""
    setFailure("")
    failedRef.current = false
    turnDoneRef.current = false
    stoppedRef.current = false
    setRunning(true)
    if (projectRoot.trim()) rememberProject(projectRoot.trim())

    const controller = new AbortController()
    abortRef.current = controller
    try {
      await agentChatStream(
        { prompt: text, resume: thread, projectRoot: projectRoot.trim(), write: write && allowWrite },
        (event) => {
          if (event.kind === "engine") {
            setEngine(event.version + "（" + event.source + "）")
            return
          }
          if (event.kind === "failure") {
            failedRef.current = true
            setFailure(event.message + (event.hint ? "；" + event.hint : ""))
            return
          }
          if (event.kind === "exit") {
            if (event.code !== 0) {
              if (!failedRef.current) setFailure("Codex 退出码 " + event.code + "；下面是引擎日志。")
              failedRef.current = true
            } else if (!turnDoneRef.current && !stoppedRef.current) {
              if (!failedRef.current) setFailure("这一轮没有正常收尾；下面是引擎日志。")
              failedRef.current = true
            }
            flushEngineLog()
            return
          }
          if (event.kind === "line") {
            if (event.stream !== "stdout") {
              stderrRef.current += event.line + "\n"
              return
            }
            const item = readCodexLine(event.line)
            if (!item) return
            if (item.kind === "thread") {
              setThread(item.id)
              return
            }
            // 一轮没跑完（turn.failed）时把这一轮的引擎日志标成默认铺开。
            if (item.kind === "failure") {
              failedRef.current = true
            }
            if (item.kind === "turn") turnDoneRef.current = true
            push(item)
          }
        },
        controller.signal
      )
    } catch (error) {
      if (!controller.signal.aborted) setFailure(describeFailure(error))
    } finally {
      // 半路断线（含点「停下」）时收不到 exit 事件，日志在这里补挂。
      flushEngineLog()
      abortRef.current = null
      setRunning(false)
    }
  }

  function stop() {
    stoppedRef.current = true
    abortRef.current?.abort()
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>对话</CardTitle>
          <CardDescription>
            直接问 Codex；它能在你给的工程目录里读文件、跑命令。写盘默认不给，要在设置里开、这里再勾一次。
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {engine ? <Badge variant="secondary">Codex v{engine}</Badge> : <Badge variant="outline">还没开始</Badge>}
            {thread && <Badge variant="outline">对话 {thread.slice(0, 8)}</Badge>}
            {settings && (
              <span className="text-muted-foreground text-xs">
                {settings.ai.model || "没配模型"}
                {settings.ai.hasKey ? "" : "（没有 key，去设置里填）"}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="chat-project">工程目录（可选）</Label>
            <Input
              id="chat-project"
              spellCheck={false}
              list="chat-projects"
              placeholder="填工程目录的绝对路径；给了它才能读这个目录里的文件"
              value={projectRoot}
              onChange={(event) => setProjectRoot(event.target.value)}
            />
            <datalist id="chat-projects">
              {readRecentProjects().map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="chat-prompt">要问什么</Label>
            <Textarea
              id="chat-prompt"
              rows={3}
              placeholder="例如：看一下 F1 这个页面生成到哪一步了，缺什么？"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send()
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={write && allowWrite} disabled={!allowWrite} onCheckedChange={setWrite} />
              这次允许它直接改工程文件
              {!allowWrite && <span className="text-muted-foreground text-xs">（先在设置里开写盘开关）</span>}
            </label>
            <div className="flex items-center gap-2">
              {running && (
                <Button variant="outline" onClick={stop}>
                  <Square className="size-4" />
                  停下
                </Button>
              )}
              <Button disabled={running || !prompt.trim()} onClick={() => void send()}>
                {running ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                发送
              </Button>
            </div>
          </div>

          {failure && (
            <Alert variant="destructive">
              <AlertTitle>这次没跑起来</AlertTitle>
              <AlertDescription>
                <ClampText text={failure} />
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>对话记录</CardTitle>
          <CardDescription>关掉这个页面就清空；要接着上一次说，就在同一个页面里继续问。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ChatTranscript
            turns={turns}
          />
        </CardContent>
      </Card>
    </div>
  )
}
