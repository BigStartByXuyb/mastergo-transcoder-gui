import { useState } from "react"
import { Info, Terminal, User } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ClampText } from "@/app/clamp-text"
import type { AgentItem } from "@/lib/agent-stream"

export type Turn =
  | { kind: "you"; text: string }
  | { kind: "agent"; item: AgentItem }
  | { kind: "log"; text: string; open: boolean }

/*
 * 对话记录：一次提问之后按顺序贴出来的东西。
 *
 * 条目分四档，判断只在这里：
 *   message  正文
 *   notice   一轮里引擎自己报的提示（这一轮照样跑完），浅色一行
 *   failure  这一轮没跑完，红色卡片
 *   command  跑过的命令，带输出与退出码
 *
 * 引擎日志按轮贴在那一轮的末尾：默认收着，收尾不干净（open）或人手动点开时才铺开。
 */
export function ChatTranscript(props: { turns: Turn[] }) {
  return (
    <div className="flex flex-col gap-3">
      {props.turns.length === 0 && <p className="text-muted-foreground text-sm">还没有对话。</p>}
      {props.turns.map((turn, index) =>
        turn.kind === "you" ? (
          <div key={index} className="flex items-start gap-2">
            <User className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <p className="text-sm whitespace-pre-wrap">{turn.text}</p>
          </div>
        ) : turn.kind === "log" ? (
          <EngineLog key={index} text={turn.text} open={turn.open} />
        ) : (
          <TurnView key={index} item={turn.item} />
        )
      )}
    </div>
  )
}

function EngineLog({ text, open }: { text: string; open: boolean }) {
  const [shown, setShown] = useState(open)
  const body = text.replace(/\n+$/, "")
  if (!body) return null
  const lines = body.split("\n").length
  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => setShown((current) => !current)}>
        <Terminal className="size-3" />
        引擎日志（{lines} 行）
      </Button>
      {shown && (
        <pre className="bg-muted text-muted-foreground max-h-60 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
          {body}
        </pre>
      )}
    </div>
  )
}

function TurnView({ item }: { item: AgentItem }) {
  if (item.kind === "message") {
    return <p className="text-sm whitespace-pre-wrap">{item.text}</p>
  }
  if (item.kind === "notice") {
    return (
      <div className="text-muted-foreground flex items-start gap-2 text-xs">
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
      <p className="text-muted-foreground text-xs">
        一轮结束{item.tokens === null ? "" : "（用了 " + item.tokens + " tokens）"}
      </p>
    )
  }
  if (item.kind === "thread") {
    return <p className="text-muted-foreground text-xs">对话 {item.id.slice(0, 8)} 已开</p>
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground flex items-center gap-2 text-xs">
        <Terminal className="size-3" />
        <span className="min-w-0 flex-1 truncate font-mono" title={item.command}>
          {item.command}
        </span>
        <Badge variant={item.exitCode === 0 ? "outline" : "destructive"}>
          {item.exitCode === null ? "没退出码" : "exit " + item.exitCode}
        </Badge>
      </div>
      {item.output && (
        <pre className="bg-muted max-h-60 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">{item.output}</pre>
      )}
    </div>
  )
}
