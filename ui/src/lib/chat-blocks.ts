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

/*
 * 哪一块该带头像：每一轮里它第一次开口的那一块带一次。
 * 一轮 = 从你那句话到下一句话之间；开头（你还没说话时它的第一轮）也算一轮。
 *
 * 优先挂在正文上；这一轮只有动作没说话（只跑命令、只改文件）时挂在过程组上，
 * 于是每一轮都露一次头像，而不是整段对话只有最开头那一个。
 */
export function leadFlags(blocks: Block[]): boolean[] {
  const flags = blocks.map(() => false)
  const mark = (from: number, to: number) => {
    for (let index = from; index < to; index += 1) {
      const block = blocks[index]
      if (block.kind === "single" && block.turn.kind === "agent" && block.turn.item.kind === "message") {
        flags[index] = true
        return
      }
    }
    for (let index = from; index < to; index += 1) {
      if (blocks[index].kind === "steps") {
        flags[index] = true
        return
      }
    }
  }
  let start = 0
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.kind === "single" && block.turn.kind === "you") {
      mark(start, index)
      start = index + 1
    }
  }
  mark(start, blocks.length)
  return flags
}
