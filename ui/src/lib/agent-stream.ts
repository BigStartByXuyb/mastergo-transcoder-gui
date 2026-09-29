/*
 * 对话这一路的两种解析，都只做纯字符串 → 结构体的变换：
 *
 *   1. 传输：后端把一次 codex 进程的 stdout/stderr 按行写成 NDJSON，每行一条事件。
 *   2. 内容：codex exec --json 的每行本身又是 JSONL（thread / item / turn）。
 *
 * 界面只认这里定义的形状，后端换行协议时改这一处。
 */

export type AgentStreamEvent =
  | { kind: "engine"; version: string; source: string; state: string }
  | { kind: "line"; stream: string; line: string }
  | { kind: "failure"; code: string; message: string; hint: string }
  | { kind: "exit"; code: number }

export type AgentItem =
  | { kind: "message"; text: string }
  | { kind: "command"; command: string; output: string; exitCode: number | null }
  | { kind: "failure"; text: string }
  | { kind: "thread"; id: string }
  | { kind: "turn"; tokens: number | null }

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
  if (type === "thread.started") return { kind: "thread", id: textOf(payload.thread_id) }
  if (type === "turn.completed") {
    const usage = asRecord(payload.usage)
    const tokens = typeof usage?.total_tokens === "number" ? usage.total_tokens : null
    return { kind: "turn", tokens: tokens }
  }
  if (type === "turn.failed" || type === "error") {
    const error = asRecord(payload.error)
    return { kind: "failure", text: textOf(error?.message) || textOf(payload.message) || "这次提问没有跑完" }
  }
  if (type !== "item.completed") return null

  const item = asRecord(payload.item)
  const itemType = textOf(item?.type)
  if (itemType === "agent_message") return { kind: "message", text: textOf(item?.text) }
  if (itemType === "command_execution") {
    return {
      kind: "command",
      command: textOf(item?.command),
      output: textOf(item?.aggregated_output),
      exitCode: typeof item?.exit_code === "number" ? item.exit_code : null
    }
  }
  if (itemType === "error") return { kind: "failure", text: textOf(item?.message) }
  return null
}
