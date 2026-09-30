import type { AgentItem } from "@/lib/agent-stream"
import type { Turn } from "@/app/chat-transcript"

/*
 * 把一次对话的条目分成「过程组」和「单条」：
 * 连着出现的命令 / 文件改动 / 工具 / 搜索 / 思考合成一组（界面上先收成一行），
 * 正文、提示、报错、收尾这些原样单列，于是读起来还是「说了什么 → 做了什么 → 又说了什么」。
 *
 * 只在这里分组；怎么画由 ui/src/app/chat-transcript.tsx 决定。
 */

export type Block = { kind: "steps"; items: AgentItem[] } | { kind: "single"; turn: Turn }

export function isStep(item: AgentItem): boolean {
  return (
    item.kind === "command" ||
    item.kind === "fileChange" ||
    item.kind === "tool" ||
    item.kind === "search" ||
    item.kind === "reasoning"
  )
}

export function groupSteps(turns: Turn[]): Block[] {
  const blocks: Block[] = []
  let run: AgentItem[] = []
  const flush = () => {
    if (run.length) {
      blocks.push({ kind: "steps", items: run })
      run = []
    }
  }
  for (const turn of turns) {
    if (turn.kind === "agent" && isStep(turn.item)) {
      run.push(turn.item)
      continue
    }
    flush()
    blocks.push({ kind: "single", turn })
  }
  flush()
  return blocks
}
