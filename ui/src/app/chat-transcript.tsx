import { useState, type ReactNode } from "react"
import { Bot, ChevronRight, FileCode2, Globe, Info, Loader2, Sparkles, Terminal } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { EngineLog } from "@/app/chat-engine-log"
import { ClampText } from "@/app/clamp-text"
import type { AgentItem } from "@/lib/agent-stream"
import { cn } from "@/lib/utils"

export type Turn =
  | { kind: "you"; text: string }
  | { kind: "agent"; item: AgentItem }
  | { kind: "log"; text: string; open: boolean }

/*
 * 对话记录：按顺序贴出来的一轮。
 *
 * 说话分左右：你说的话靠右、带身份气泡；它说的话靠左。
 * 工具调用不占正文位置：每一次调用收成一行（图标 + 一句话 + 状态），点开才铺细节，
 * 默认全收起 —— 一屏都是命令输出就看不见答案了。
 *
 * 条目只在这里定性，别处不再判断：
 *   message   正文
 *   notice    引擎自己报的提示（这一轮照样跑完），浅色一行
 *   failure   这一轮没跑完，红色卡片
 *   command / fileChange / tool / search / reasoning   工具调用，各自一行
 */
export function ChatTranscript(props: { turns: Turn[]; agentName: string; empty?: string }) {
  const firstAgentAt = props.turns.findIndex((turn) => turn.kind === "agent")
  return (
    <div className="flex flex-col gap-3">
      {props.turns.length === 0 && (
        <p className="text-muted-foreground text-sm">{props.empty ?? "还没有对话。"}</p>
      )}
      {props.turns.map((turn, index) =>
        turn.kind === "you" ? (
          <YouBubble key={index} text={turn.text} />
        ) : turn.kind === "log" ? (
          <EngineLog key={index} text={turn.text} open={turn.open} />
        ) : (
          <AgentItemView key={index} item={turn.item} agentName={props.agentName} lead={index === firstAgentAt} />
        )
      )}
    </div>
  )
}

/* 你说的话：靠右，气泡旁边挂一个身份标识。 */
function YouBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] items-start gap-2">
        <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3.5 py-2 text-sm break-words whitespace-pre-wrap shadow-sm">
          {text}
        </div>
        <span className="bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px]">
          你
        </span>
      </div>
    </div>
  )
}

function AgentItemView({ item, agentName, lead }: { item: AgentItem; agentName: string; lead: boolean }) {
  if (item.kind === "message") {
    return (
      <div className="flex max-w-[85%] items-start gap-2">
        {lead ? <AgentChip name={agentName} /> : <span className="size-6 shrink-0" />}
        {/* 它说的话：白底 + 描边，坐在浅一档的消息区上，和你那条深色气泡分得开。 */}
        <div className="bg-card rounded-2xl rounded-tl-sm border px-3.5 py-2 text-sm break-words whitespace-pre-wrap">
          {item.text}
        </div>
      </div>
    )
  }
  if (item.kind === "notice") {
    return (
      <div className="text-muted-foreground flex items-start gap-2 pl-8 text-xs">
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
      <p className="text-muted-foreground pl-8 text-xs">
        一轮结束{item.tokens === null ? "" : "（用了 " + item.tokens + " tokens）"}
      </p>
    )
  }
  if (item.kind === "thread") {
    return <p className="text-muted-foreground pl-8 text-xs">对话 {item.threadId.slice(0, 8)} 已开</p>
  }
  if (item.kind === "reasoning") {
    return (
      <Step icon={<Sparkles className="size-3.5" />} title="思考过程" running={item.running}>
        <pre className="bg-muted text-muted-foreground max-h-80 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
          {item.text}
        </pre>
      </Step>
    )
  }
  if (item.kind === "command") {
    return (
      <Step
        icon={<Terminal className="size-3.5" />}
        title={prettyCommand(item.command)}
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
        title={"改了 " + item.changes.length + " 个文件"}
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
        title={[item.server, item.tool].filter(Boolean).join(" · ") || "工具调用"}
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
  return (
    <Step icon={<Globe className="size-3.5" />} title={"搜索 " + item.query} running={item.running}>
      <p className="bg-muted rounded-md p-3 text-xs break-words">{item.query}</p>
    </Step>
  )
}

function AgentChip({ name }: { name: string }) {
  return (
    <span
      className="bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px]"
      title={name}
    >
      AI
    </span>
  )
}

/*
 * 一次工具调用占一行：图标 + 一句话 + 状态，点开才铺细节。
 * 折叠状态在本地，不进存档 —— 重开页面回到「全收起」。
 */
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
    <div className="flex flex-col gap-1.5 pl-8">
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
      {shown && <div className="flex flex-col gap-2">{props.children}</div>}
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
