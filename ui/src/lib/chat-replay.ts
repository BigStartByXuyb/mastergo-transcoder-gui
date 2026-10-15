import { readCodexLine, type AgentItem } from "@/lib/agent-stream"
import type { ChatTurn } from "@/lib/api"
import type { Turn } from "@/app/chat-transcript"

/*
 * 把存档摊成界面上的条目。存的是引擎原始行，所以重放与实时收流走同一个解析
 * （lib/agent-stream.ts），换引擎输出格式时不用改两处。
 */

/*
 * 同一条目按 id 原地更新，但只在本轮里找：引擎的 item id 每轮从 item_0 重来，
 * 跨轮去匹配会改到上一轮的同名条目。往回扫到「你」那句为止，就是本轮的地盘。
 */
export function upsertTurn(turns: Turn[], item: AgentItem): Turn[] {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn.kind === "you") break
    if (turn.kind === "agent" && turn.item.itemId === item.itemId) {
      const next = turns.slice()
      next[index] = { kind: "agent", item }
      return next
    }
  }
  return [...turns, { kind: "agent", item }]
}

export function replayConversation(turns: ChatTurn[]): { turns: Turn[]; thread: string } {
  let out: Turn[] = []
  let thread = ""
  for (const turn of turns) {
    out.push({ kind: "you", text: turn.prompt })
    let stderr = ""
    for (const entry of turn.lines) {
      if (entry.stream !== "stdout") {
        stderr += entry.line + "\n"
        continue
      }
      const item = readCodexLine(entry.line)
      if (!item) continue
      if (item.kind === "thread") thread = item.threadId
      // 收尾时被断开的那一轮没有退出码，按「没收尾」算，日志铺开给人看原因。
      out = upsertTurn(out, item)
    }
    if (stderr.trim()) {
      out.push({ kind: "log", text: stderr.replace(/\n+$/, ""), open: turn.exitCode !== 0 })
    }
  }
  return { turns: out, thread }
}
