import { useCallback, useEffect, useRef, useState } from "react"
import { FileUp, FolderUp, ImagePlus, Loader2, Plus, Paperclip, Send, Settings2, Square, Trash2, X } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChatTranscript, type Turn } from "@/app/chat-transcript"
import { ClampText } from "@/app/clamp-text"
import { TemplateDialog } from "@/app/template-dialog"
import { agentChatStream, api, type ChatSummary, type Settings, type UploadedFile } from "@/lib/api"
import { readCodexLine, type AgentItem } from "@/lib/agent-stream"
import { replayConversation, upsertTurn } from "@/lib/chat-replay"
import { describeFailure } from "@/lib/describe-failure"
import { readRecentProjects, rememberProject } from "@/lib/recent-projects"
import { attachmentUrl, humanSize, uploadAttachments, type PickedFile } from "@/lib/upload-files"
import { cn } from "@/lib/utils"

/*
 * 对话页：左边是对话记录，右边是这一条的消息区与输入框。
 *
 * 一次提问就是一次 codex exec；每一条对话在安装根的 chats.json 里，重开页面还在，
 * 续跑认 thread id（codex exec resume），所以在同一条对话里接着说就是接着上次的上下文。
 *
 * 写盘默认关：关着时 Codex 只读；开着且这里也勾了，才允许它直接改工程文件。
 * 开写盘还要再确认一遍改的是哪个目录 —— 范围就这一次的工程目录，后端拿到确认串才放行。
 * 引擎日志按轮收尾：正常跑完的 stderr 有「Reading additional input from stdin」这类噪音，
 * 默认收着；收尾不干净（收到失败事件或退出码非 0）才自动铺开。
 *
 * 一红就是真没跑完：只有传输失败、turn.failed、退出码非 0、退出码 0 却没收尾（且不是人点停下）才出红卡。
 */
export function ChatPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [conversations, setConversations] = useState<ChatSummary[]>([])
  const [activeId, setActiveId] = useState("")
  const [turns, setTurns] = useState<Turn[]>([])
  const [agentName, setAgentName] = useState("")
  const [projectRoot, setProjectRoot] = useState(() => readRecentProjects()[0] ?? "")
  const [prompt, setPrompt] = useState("")
  const [write, setWrite] = useState(false)
  const [writeConfirmed, setWriteConfirmed] = useState(false)
  const [thread, setThread] = useState("")
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState("")
  // 这次要一起发给它的东西：图片会被 Codex 直接看，别的给路径让它去读。
  const [attachments, setAttachments] = useState<UploadedFile[]>([])
  // 这条对话用哪份提示词模板（代码库 + 系统提示词一起生效）。
  const [templateId, setTemplateId] = useState("")
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const imageInput = useRef<HTMLInputElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const folderInput = useRef<HTMLInputElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const failedRef = useRef(false)
  const stderrRef = useRef("")
  const turnDoneRef = useRef(false)
  const stoppedRef = useRef(false)

  /*
   * 打开一条存档：重放它的原始行，得到条目、续跑 id 与上次的工程目录。
   * 只碰 setState 与接口，所以身份是稳定的 —— 挂载那一次可以直接用它，不必再抄一遍。
   */
  const loadInto = useCallback(async (id: string) => {
    setActiveId(id)
    setFailure("")
    try {
      const payload = await api.chatGet(id)
      const replayed = replayConversation(payload.conversation.turns)
      setTurns(replayed.turns)
      setThread(replayed.thread)
      setAgentName(payload.conversation.agent)
      setTemplateId(payload.conversation.templateId || "")
      if (payload.conversation.projectRoot) setProjectRoot(payload.conversation.projectRoot)
    } catch (error) {
      setFailure(describeFailure(error))
    }
  }, [])

  useEffect(() => {
    api
      .settingsGet()
      .then((payload) => setSettings(payload.settings))
      .catch((error) => setFailure(describeFailure(error)))
    // 进来先接着最近那条说：列表非空就打开最上面一条，省得每回都要点一下。
    api
      .chatList()
      .then((payload) => {
        setConversations(payload.conversations)
        const recent = payload.conversations[0]
        if (recent) void loadInto(recent.id)
      })
      .catch((error) => setFailure(describeFailure(error)))
  }, [loadInto])

  // 新消息落在底部：只在条目数变化时滚，不打断人往回翻。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [turns.length])

  function refreshList() {
    api
      .chatList()
      .then((payload) => setConversations(payload.conversations))
      .catch((error) => setFailure(describeFailure(error)))
  }

  const allowWrite = Boolean(settings?.agent.allowWrite)
  /* 勾了写盘却没确认改哪个目录，这一轮不发出去；后端同样会拦。 */
  const writeBlocked = write && allowWrite && !writeConfirmed
  const active = conversations.find((item) => item.id === activeId) ?? null

  /* 跑着的时候不许切走：切了也看不到这一轮的进度。 */
  async function open(id: string) {
    if (running) return
    await loadInto(id)
  }

  /* 新建：只把这一侧清空，后端在第一次提问时建档，标题取第一句。 */
  function startNew() {
    if (running) return
    setActiveId("")
    setTemplateId("")
    setTurns([])
    setThread("")
    setAgentName("")
    setFailure("")
  }

  async function drop(id: string) {
    try {
      const payload = await api.chatRemove(id)
      setConversations(payload.conversations)
      if (id === activeId) startNew()
    } catch (error) {
      setFailure(describeFailure(error))
    }
  }

  function pushAgent(item: AgentItem) {
    setTurns((current) => upsertTurn(current, item))
  }

  function flushEngineLog() {
    const text = stderrRef.current.replace(/\n+$/, "")
    stderrRef.current = ""
    if (!text) return
    setTurns((current) => [...current, { kind: "log", text, open: failedRef.current }])
  }

  async function send() {
    const text = prompt.trim()
    if (!text || running || writeBlocked) return
    setTurns((current) => [...current, { kind: "you", text }])
    const sending = attachments
    setAttachments([])
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
        {
          prompt: text,
          resume: thread,
          conversationId: activeId,
          attachments: sending.map((item) => ({ path: item.path, name: item.name, kind: item.kind })),
          templateId: templateId,
          projectRoot: projectRoot.trim(),
          write: write && allowWrite,
          writeConfirm: projectRoot.trim()
        },
        (event) => {
          if (event.kind === "conversation") {
            setActiveId(event.id)
            return
          }
          if (event.kind === "engine") {
            setAgentName("Codex v" + event.version + "（" + event.source + "）")
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
            refreshList()
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
              setThread(item.threadId)
              return
            }
            // 一轮没跑完（turn.failed）时把这一轮的引擎日志标成默认铺开。
            if (item.kind === "failure") failedRef.current = true
            if (item.kind === "turn") turnDoneRef.current = true
            pushAgent(item)
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
      refreshList()
    }
  }

  function stop() {
    stoppedRef.current = true
    abortRef.current?.abort()
  }

  /* 选文件 / 选文件夹 / 拖进来，三条路都走同一个上传。 */
  async function attach(picked: PickedFile[]) {
    if (picked.length === 0) return
    setUploading(true)
    setFailure("")
    try {
      const saved = await uploadAttachments(picked)
      setAttachments((current) => [...current, ...saved])
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setUploading(false)
    }
  }

  async function attachFrom(input: HTMLInputElement | null) {
    if (!input || !input.files) return
    const files = Array.from(input.files).map((file) => ({
      file: file,
      relativePath: input === folderInput.current ? file.webkitRelativePath : undefined
    }))
    input.value = ""
    await attach(files)
  }

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* 对话记录：标题 + 来源，够认出是哪一条就行；正文不进这一列。 */}
      <aside className="bg-muted/60 flex w-64 shrink-0 flex-col gap-2 rounded-lg border p-2">
        <Button variant="outline" className="justify-start" onClick={startNew} disabled={running}>
          <Plus className="size-4" />
          新建对话
        </Button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="text-muted-foreground px-1 py-2 text-xs leading-relaxed">
              还没有对话。问一句就会在这里留下一条。
            </p>
          )}
          <div className="flex flex-col gap-1">
            {conversations.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "group hover:bg-accent/60 flex items-start gap-1 rounded-md px-2 py-2 transition-colors",
                  item.id === activeId && "bg-accent text-accent-foreground"
                )}
              >
                <button
                  type="button"
                  onClick={() => void open(item.id)}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                  title={item.title}
                >
                  <span className="min-w-0 truncate text-sm">{item.title}</span>
                  <span className="text-muted-foreground min-w-0 truncate text-xs" title={item.agent}>
                    {item.agent || "还没跑过"}
                  </span>
                </button>
                <button
                  type="button"
                  title="删除这条对话"
                  onClick={() => void drop(item.id)}
                  className="text-muted-foreground hover:text-destructive mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {/* 这一条对话的身份与设置：标题、来源、模板。 */}
        <header className="bg-card flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{active?.title ?? "新对话"}</span>
          {agentName ? <Badge variant="secondary">{agentName}</Badge> : <Badge variant="outline">还没开始</Badge>}
          {thread && <Badge variant="outline">对话 {thread.slice(0, 8)}</Badge>}
          {/* 提示词模板：一条对话用一份，代码库与系统提示词一起生效。 */}
          {settings && (
            <div className="flex items-center gap-1">
              <Select value={templateId || settings.activeTemplateId} onValueChange={(value) => setTemplateId(value)}>
                <SelectTrigger size="sm" className="w-44" title="这条对话用哪份提示词模板">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {settings.templates.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" title="管理模板" onClick={() => setTemplatesOpen(true)}>
                <Settings2 className="size-3.5" />
                模板
              </Button>
            </div>
          )}
          <span className="text-muted-foreground text-xs">
            {settings?.ai.model || "没配模型"}
            {settings?.ai.hasKey === false ? "（没有 key，去设置里填）" : ""}
          </span>
        </header>

        {/* 消息区自己是一块：底色调浅一档，白色气泡与深色气泡都跳得出来。 */}
        <div className="bg-muted/60 min-h-0 flex-1 overflow-y-auto rounded-lg border p-4">
          <ChatTranscript
            turns={turns}
            agentName={agentName || "Codex"}
            empty="问一句试试。它能在你给的工程目录里读文件、跑命令。"
          />
          <div ref={bottomRef} />
        </div>

        {/* 你操作的那一块：自己成一张卡，边框 + 卡片底，跟上面的消息区分开。 */}
        <div
          className={cn(
            "bg-card flex flex-col gap-3 rounded-lg border p-3",
            dragging && "border-primary outline-2 outline-offset-2 outline-dashed"
          )}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void attach(Array.from(event.dataTransfer.files).map((file) => ({ file })))
          }}
        >
          {/* 第一组：附件（图片会被它直接看，文件和文件夹给路径让它去读）。 */}
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs font-medium">附件</span>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((item) => (
                <span
                  key={item.path}
                  className="bg-muted flex items-center gap-2 rounded-md px-2 py-1 text-xs"
                  title={item.path}
                >
                  {item.kind === "image" ? (
                    <img src={attachmentUrl(item.path)} alt="" className="size-8 rounded object-cover" />
                  ) : (
                    <Paperclip className="text-muted-foreground size-3.5 shrink-0" />
                  )}
                  <span className="max-w-40 truncate">{item.name}</span>
                  <span className="text-muted-foreground">{humanSize(item.bytes)}</span>
                  <button
                    type="button"
                    title="不要这个附件"
                    onClick={() => setAttachments((current) => current.filter((one) => one.path !== item.path))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1">
            <input
              ref={imageInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={() => void attachFrom(imageInput.current)}
            />
            <input ref={fileInput} type="file" multiple className="hidden" onChange={() => void attachFrom(fileInput.current)} />
            {/* 选文件夹：webkitdirectory 是浏览器的事实标准，Chrome/Edge 都认。 */}
            <input
              ref={folderInput}
              type="file"
              multiple
              className="hidden"
              onChange={() => void attachFrom(folderInput.current)}
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            />
            <Button size="sm" variant="ghost" disabled={uploading} onClick={() => imageInput.current?.click()}>
              <ImagePlus className="size-3.5" />
              图片
            </Button>
            <Button size="sm" variant="ghost" disabled={uploading} onClick={() => fileInput.current?.click()}>
              <FileUp className="size-3.5" />
              文件
            </Button>
            <Button size="sm" variant="ghost" disabled={uploading} onClick={() => folderInput.current?.click()}>
              <FolderUp className="size-3.5" />
              文件夹
            </Button>
            {uploading ? (
              <span className="text-muted-foreground text-xs">正在上传…</span>
            ) : (
              <span className="text-muted-foreground text-xs">也可以把文件直接拖到这里</span>
            )}
          </div>
          </div>

          {/* 第二组：这次让它读哪个工程目录。 */}
          <div className="grid gap-1.5">
            <Label htmlFor="chat-project" className="text-muted-foreground text-xs font-medium">
              工程目录（可选）
            </Label>
            <Input
              id="chat-project"
              spellCheck={false}
              list="chat-projects"
              className="font-mono text-xs"
              placeholder="给了它才能读这个目录里的文件"
              value={projectRoot}
              onChange={(event) => {
                setProjectRoot(event.target.value)
                // 换了目录，上一次的确认就不算数了。
                setWriteConfirmed(false)
              }}
            />
            <datalist id="chat-projects">
              {readRecentProjects().map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>

          {/* 第三组：要问什么。 */}
          <div className="grid gap-1.5">
            <Label htmlFor="chat-prompt" className="text-muted-foreground text-xs font-medium">
              要问什么
            </Label>
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

          {write && allowWrite && (
            <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
              <p className="text-xs">
                写盘只落在这一份工程目录之内，别处一律不动：
                <span className="font-mono">{projectRoot.trim() || "（还没填工程目录，开不了写盘）"}</span>
              </p>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={writeConfirmed}
                  disabled={!projectRoot.trim()}
                  onCheckedChange={(value) => setWriteConfirmed(value === true)}
                />
                我确认这次只让它改这个目录里的文件
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={write && allowWrite}
                disabled={!allowWrite}
                onCheckedChange={(value) => {
                  setWrite(value)
                  setWriteConfirmed(false)
                }}
              />
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
              <Button disabled={running || !prompt.trim() || writeBlocked} onClick={() => void send()}>
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
        </div>
      </section>

      {settings && (
        <TemplateDialog
          open={templatesOpen}
          settings={settings}
          save={(patch) => api.settingsSave(patch).then((payload) => payload.settings)}
          onSaved={(saved) => setSettings(saved)}
          onOpenChange={setTemplatesOpen}
        />
      )}
    </div>
  )
}
