/*
 * 对话这一路的两种解析，都只做纯字符串 → 结构体的变换：
 *
 *   1. 传输：后端把一次 codex 进程的 stdout/stderr 按行写成 NDJSON，每行一条事件。
 *   2. 内容：codex exec --json 的每行本身又是 JSONL（thread / item / turn）。
 *
 * 界面只认这里定义的形状，后端换行协议时改这一处。
 */

export type AgentStreamEvent =
  | { kind: "conversation"; id: string; title: string }
  | { kind: "engine"; version: string; source: string; state: string }
  | { kind: "line"; stream: string; line: string }
  | { kind: "failure"; code: string; message: string; hint: string }
  | { kind: "exit"; code: number }

/** 一次文件改动：路径 + add / update / delete。引擎只给这些，不给行数。 */
export type AgentChange = { path: string; action: string }

/*
 * 一条条目 = 引擎里的一个 item。带 itemId 的条目按 id 原地更新（started → completed），
 * 所以界面能看见「正在跑的命令」而不是等它跑完才冒出来。
 */
export type AgentItem =
  | { kind: "message"; itemId: string; text: string }
  | { kind: "notice"; itemId: string; text: string }
  | { kind: "reasoning"; itemId: string; text: string; running: boolean }
  | { kind: "command"; itemId: string; command: string; output: string; exitCode: number | null; running: boolean }
  | { kind: "fileChange"; itemId: string; changes: AgentChange[]; running: boolean }
  | { kind: "tool"; itemId: string; server: string; tool: string; args: string; output: string; running: boolean }
  | { kind: "search"; itemId: string; query: string; running: boolean }
  | { kind: "failure"; itemId: string; text: string }
  | { kind: "thread"; itemId: string; threadId: string }
  | { kind: "turn"; itemId: string; tokens: number | null }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/* 一行传输报文 → 事件；解不出来（半行、脏数据）返回 null，由调用方丢弃。 */
export function parseAgentStreamLine(raw: string): AgentStreamEvent | null {
  const line = raw.trim()
  if (!line) return null
  let payload: Record<string, unknown> | null = null
  try {
    payload = asRecord(JSON.parse(line))
  } catch {
    return null
  }
  if (!payload) return null
  // 失败只有这一种写法：ok=false，原因在 error 里。
  if (payload.ok === false) {
    const failure = asRecord(payload.error)
    return {
      kind: "failure",
      code: textOf(failure?.code),
      message: textOf(failure?.message) || "Codex 这一步没跑起来",
      hint: textOf(failure?.hint)
    }
  }
  if (payload.ok !== true) return null
  if (typeof payload.exit === "number") return { kind: "exit", code: payload.exit }
  if (payload.conversation) {
    const conversation = asRecord(payload.conversation)
    return { kind: "conversation", id: textOf(conversation?.id), title: textOf(conversation?.title) }
  }
  if (payload.engine) {
    const engine = asRecord(payload.engine)
    return {
      kind: "engine",
      version: textOf(engine?.version),
      source: textOf(engine?.source),
      state: textOf(engine?.state)
    }
  }
  if (typeof payload.line === "string") {
    return { kind: "line", stream: textOf(payload.stream) || "stdout", line: payload.line }
  }
  return null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/* 一行 codex exec --json 输出 → 界面条目；不认识的行返回 null。 */
export function readCodexLine(line: string): AgentItem | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("{")) return null
  let payload: Record<string, unknown> | null = null
  try {
    payload = asRecord(JSON.parse(trimmed))
  } catch {
    return null
  }
  if (!payload) return null

  const type = textOf(payload.type)
  if (type === "thread.started") {
    return { kind: "thread", itemId: "thread", threadId: textOf(payload.thread_id) }
  }
  if (type === "turn.completed") {
    const usage = asRecord(payload.usage)
    // 引擎给的是分项（输入 / 输出），没有合计；合计在这里算一次。
    const input = numberOrNull(usage?.input_tokens) ?? 0
    const output = numberOrNull(usage?.output_tokens) ?? 0
    const total = numberOrNull(usage?.total_tokens) ?? (input + output || null)
    return { kind: "turn", itemId: "turn", tokens: total }
  }
  if (type === "turn.failed") {
    const error = asRecord(payload.error)
    return {
      kind: "failure",
      itemId: "turn.failed",
      text: textOf(error?.message) || textOf(payload.message) || "这次提问没有跑完"
    }
  }
  // 引擎级的 error（重试、网络抖动、模型元数据这类）不直接判定这一轮失败：
  // 跑没跑完只看 turn.completed / 退出码，界面在收尾时统一定性。
  if (type === "error") {
    const error = asRecord(payload.error)
    return {
      kind: "notice",
      itemId: "error:" + (textOf(payload.message) || textOf(error?.message)).slice(0, 24),
      text: textOf(payload.message) || textOf(error?.message) || "引擎报了一条错误"
    }
  }
  if (type !== "item.started" && type !== "item.updated" && type !== "item.completed") return null

  const item = asRecord(payload.item)
  const itemId = textOf(item?.id)
  const itemType = textOf(item?.type)
  // 只有 item.completed 才算这一条跑完；started / updated 都是「还在跑」。
  const running = type !== "item.completed" && textOf(item?.status) !== "completed"
  if (itemType === "agent_message") {
    return { kind: "message", itemId: itemId, text: textOf(item?.text) }
  }
  if (itemType === "reasoning") {
    return { kind: "reasoning", itemId: itemId, text: textOf(item?.text) || textOf(item?.summary), running: running }
  }
  if (itemType === "command_execution") {
    return {
      kind: "command",
      itemId: itemId,
      command: textOf(item?.command),
      output: textOf(item?.aggregated_output),
      exitCode: numberOrNull(item?.exit_code),
      running: running
    }
  }
  if (itemType === "file_change") {
    const changes = Array.isArray(item?.changes) ? item.changes : []
    return {
      kind: "fileChange",
      itemId: itemId,
      changes: changes.map((change) => {
        const record = asRecord(change)
        return { path: textOf(record?.path), action: textOf(record?.kind) }
      }),
      running: running
    }
  }
  if (itemType === "mcp_tool_call") {
    const args = item?.arguments
    return {
      kind: "tool",
      itemId: itemId,
      server: textOf(item?.server),
      tool: textOf(item?.tool),
      args: args === undefined ? "" : JSON.stringify(args),
      output: textOf(item?.result) || textOf(item?.error),
      running: running
    }
  }
  if (itemType === "web_search" || itemType === "web_search_call") {
    return { kind: "search", itemId: itemId, query: textOf(item?.query), running: running }
  }
  // 条目级的 error 是一轮里引擎自己报的（模型元数据缺失、重试之类），这一轮照样会跑完；
  // 跑没跑完只看 turn.completed / turn.failed 与进程退出码，所以这里按提示，不按失败。
  if (itemType === "error") {
    return { kind: "notice", itemId: itemId, text: textOf(item?.message) }
  }
  return null
}

/*
 * 按 itemId 原地更新：同一条命令从 started 走到 completed 只占界面一行。
 * 没有 itemId 的（理论上不该出现）当新条目追加。
 */
export function upsertItem(items: AgentItem[], item: AgentItem): AgentItem[] {
  if (!item.itemId) return [...items, item]
  const at = items.findIndex((current) => current.itemId === item.itemId)
  if (at < 0) return [...items, item]
  const next = items.slice()
  next[at] = item
  return next
}
