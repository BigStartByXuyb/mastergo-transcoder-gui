import { useState, type ReactNode } from "react"
import { Bot, ChevronRight, FileCode2, Globe, Info, Loader2, Sparkles, Terminal } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { AgentAvatar, UserAvatar } from "@/app/agent-avatar"
import { EngineLog } from "@/app/chat-engine-log"
import { ClampText } from "@/app/clamp-text"
import type { AgentItem } from "@/lib/agent-stream"
import { groupSteps, leadFlags } from "@/lib/chat-blocks"
import { cn } from "@/lib/utils"

export type Turn =
  | { kind: "you"; text: string }
  | { kind: "agent"; item: AgentItem }
  | { kind: "log"; text: string; open: boolean }

/*
 * 对话记录：按顺序贴出来的一轮。
 *
 * 说话分左右：你说的话靠右（深色气泡），它说的话靠左（白底描边气泡）。
 * 过程类条目（命令 / 文件改动 / 工具 / 搜索 / 思考）连着出现时**先合成一条**「调用过程 N 步」，
 * 展开才看是哪几步，每一步再点开才看详情 —— 两折，默认全收起。
 * 正文（message）不进这个组，它就按原顺序夹在组与组之间，读起来还是「说了什么 → 做了什么 → 又说了什么」。
 */
export function ChatTranscript(props: { turns: Turn[]; agentName: string; empty?: string }) {
  const blocks = groupSteps(props.turns)
  // 头像按轮给：每一轮它第一次开口的那一块带一次（怎么判定在 lib/chat-blocks.ts 的 leadFlags）。
  const leads = leadFlags(blocks)
  return (
    <div className="flex flex-col gap-3">
      {props.turns.length === 0 && (
        <p className="text-muted-foreground text-sm">{props.empty ?? "还没有对话。"}</p>
      )}
      {blocks.map((block, index) =>
        block.kind === "steps" ? (
          <StepGroup key={index} items={block.items} agentName={props.agentName} lead={leads[index]} />
        ) : block.turn.kind === "you" ? (
          <YouBubble key={index} text={block.turn.text} />
        ) : block.turn.kind === "log" ? (
          <EngineLog key={index} text={block.turn.text} open={block.turn.open} />
        ) : (
          <AgentItemView key={index} item={block.turn.item} agentName={props.agentName} lead={leads[index]} />
        )
      )}
    </div>
  )
}

/* 你说的话：靠右，深色气泡 + 一个身份标识。 */
function YouBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] items-start gap-2">
        <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3.5 py-2 text-sm break-words whitespace-pre-wrap shadow-sm">
          {text}
        </div>
        <UserAvatar />
      </div>
    </div>
  )
}

/*
 * 一组过程：收起时只有一行（几步 + 第一步是什么），点开才列出每一步；
 * 每一步仍是可展开的一行，详情（命令原文、输出、改动的文件）在第二层。
 */
function StepGroup({ items, agentName, lead }: { items: AgentItem[]; agentName: string; lead: boolean }) {
  const [shown, setShown] = useState(false)
  const running = items.some((item) => "running" in item && item.running)
  return (
    <div className="flex items-start gap-2">
      {/* 这一轮只跑命令、没说话时，头像挂在这一组上：每一轮都露一次。 */}
      {lead ? <AgentAvatar name={agentName} /> : <span className="size-8 shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setShown((current) => !current)}
        title="展开看每一步；每一步还能再点开看详情"
        className="border-border/70 bg-card/60 hover:bg-card flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors"
      >
        <ChevronRight className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", shown && "rotate-90")} />
        <span className="shrink-0 font-medium">调用过程 {items.length} 步</span>
        {/* 展开后就不再重复第一步的名字了（下面每一行自己写着）。 */}
        {!shown && <span className="text-muted-foreground min-w-0 flex-1 truncate">{stepTitle(items[0])}</span>}
        {shown && <span className="flex-1" />}
        {running && <Loader2 className="text-muted-foreground size-3 shrink-0 animate-spin" />}
      </button>
      {shown && (
        <div className="bg-card/70 flex flex-col gap-0.5 rounded-md border p-1">
          {items.map((item, index) => (
            <StepRow key={item.itemId || index} item={item} />
          ))}
        </div>
      )}
      </div>
    </div>
  )
}

function AgentItemView({ item, agentName, lead }: { item: AgentItem; agentName: string; lead: boolean }) {
  if (item.kind === "message") {
    return (
      <div className="flex max-w-[85%] items-start gap-2">
        {lead ? <AgentAvatar name={agentName} /> : <span className="size-8 shrink-0" />}
        {/* 它说的话：白底 + 描边，坐在浅一档的消息区上，和你那条深色气泡分得开。 */}
        <div className="bg-card rounded-2xl rounded-tl-sm border px-3.5 py-2 text-sm break-words whitespace-pre-wrap">
          {item.text}
        </div>
      </div>
    )
  }
  if (item.kind === "notice") {
    return (
      <div className="text-muted-foreground flex items-start gap-2 pl-10 text-xs">
        <Info className="mt-0.5 size-3 shrink-0" />
        <ClampText text={item.text} />
      </div>
    )
  }
  if (item.kind === "failure") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Codex 报错</AlertTitle>
        <AlertDescription>
          <ClampText text={item.text} />
        </AlertDescription>
      </Alert>
    )
  }
  if (item.kind === "turn") {
    return (
      <p className="text-muted-foreground pl-10 text-xs">
        一轮结束{item.tokens === null ? "" : "（用了 " + item.tokens + " tokens）"}
      </p>
    )
  }
  if (item.kind === "thread") {
    return <p className="text-muted-foreground pl-10 text-xs">对话 {item.threadId.slice(0, 8)} 已开</p>
  }
  return <StepGroup items={[item]} agentName={agentName} lead={lead} />
}

/* 每一步一行：图标 + 一句话 + 状态，点开才铺细节。 */
function StepRow({ item }: { item: AgentItem }) {
  // 标题只认 stepTitle 一处，展开与收起说的是同一句话。
  const title = stepTitle(item)
  if (item.kind === "reasoning") {
    return (
      <Step icon={<Sparkles className="size-3.5" />} title={title} running={item.running}>
        <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
          {item.text}
        </pre>
      </Step>
    )
  }
  if (item.kind === "command") {
    return (
      <Step
        icon={<Terminal className="size-3.5" />}
        title={title}
        mono
        running={item.running}
        status={item.running ? "" : item.exitCode === null ? "没退出码" : "exit " + item.exitCode}
        failed={!item.running && item.exitCode !== null && item.exitCode !== 0}
      >
        <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">{item.command}</pre>
        {item.output && (
          <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">{item.output}</pre>
        )}
      </Step>
    )
  }
  if (item.kind === "fileChange") {
    return (
      <Step
        icon={<FileCode2 className="size-3.5" />}
        title={title}
        running={item.running}
        status={item.changes.map((change) => changeLabel(change.action)).join(" ")}
      >
        <ul className="bg-muted flex flex-col gap-1 rounded-md p-3 text-xs">
          {item.changes.map((change, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="text-muted-foreground w-6 shrink-0">{changeLabel(change.action)}</span>
              <span className="min-w-0 flex-1 break-all font-mono">{change.path}</span>
            </li>
          ))}
        </ul>
      </Step>
    )
  }
  if (item.kind === "tool") {
    return (
      <Step
        icon={<Bot className="size-3.5" />}
        title={title}
        running={item.running}
      >
        {item.args && (
          <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">{item.args}</pre>
        )}
        {item.output && (
          <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">{item.output}</pre>
        )}
      </Step>
    )
  }
  if (item.kind === "search") {
    return (
      <Step icon={<Globe className="size-3.5" />} title={title} running={item.running}>
        <p className="bg-muted rounded-md p-3 text-xs break-words">{item.query}</p>
      </Step>
    )
  }
  return null
}

/* 收起那一行显示「第一步是什么」，让人不用展开也知道它干了什么。 */
function stepTitle(item: AgentItem | undefined): string {
  if (!item) return ""
  if (item.kind === "command") return prettyCommand(item.command)
  if (item.kind === "fileChange") return "改了 " + item.changes.length + " 个文件"
  if (item.kind === "tool") return [item.server, item.tool].filter(Boolean).join(" · ") || "工具调用"
  if (item.kind === "search") return "搜索 " + item.query
  if (item.kind === "reasoning") return "思考过程"
  return ""
}

/* 一行 = 图标 + 一句话 + 状态；展开才铺细节。 */
function Step(props: {
  icon: ReactNode
  title: string
  status?: string
  running: boolean
  failed?: boolean
  mono?: boolean
  children: ReactNode
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setShown((current) => !current)}
        title={props.title}
        className="hover:bg-muted/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors"
      >
        <ChevronRight className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", shown && "rotate-90")} />
        <span className="text-muted-foreground shrink-0">{props.icon}</span>
        <span className={cn("min-w-0 flex-1 truncate", props.mono && "font-mono")}>{props.title}</span>
        {props.running ? (
          <Loader2 className="text-muted-foreground size-3 shrink-0 animate-spin" />
        ) : props.status ? (
          <Badge variant={props.failed ? "destructive" : "outline"} className="shrink-0">
            {props.status}
          </Badge>
        ) : null}
      </button>
      {shown && <div className="flex flex-col gap-2 pl-8">{props.children}</div>}
    </div>
  )
}

/* 引擎把命令包成「pwsh.exe -Command '...'」；折起来时只露里面真正跑的那条，展开仍旧给原文。 */
function prettyCommand(command: string) {
  const raw = String(command || "").trim()
  const hit = /^"[^"]*pwsh[^"]*"\s+-Command\s+([\s\S]+)$/i.exec(raw)
  const inner = hit ? hit[1].trim() : raw
  const line = inner.split("\n")[0]
  return line.replace(/^'(.*)'$/s, "$1") || "命令"
}

function changeLabel(action: string) {
  if (action === "add") return "新增"
  if (action === "delete") return "删除"
  if (action === "update") return "修改"
  return action || "改动"
}

