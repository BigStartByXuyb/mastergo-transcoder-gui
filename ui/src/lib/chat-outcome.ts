/*
 * 一轮对话算不算跑成：只看退出码、引擎有没有收尾、是不是人自己点停下。
 * 没跑成时给一句话；已经报过别的原因（引擎自己发了失败事件）就不再盖第二句话。
 */

export type TurnOutcome = { failed: boolean; message: string }

export function judgeTurnOutcome(input: {
  /** 子进程退出码。 */
  code: number
  /** 引擎给过 turn.completed。 */
  turnDone: boolean
  /** 人在这一轮点过「停下」。 */
  stopped: boolean
  /** 这一轮里已经有过失败（引擎发的失败事件或上一轮留下的红卡）。 */
  alreadyFailed: boolean
}): TurnOutcome {
  const failed = input.code !== 0 || (!input.turnDone && !input.stopped)
  if (!failed) return { failed: false, message: "" }
  if (input.alreadyFailed) return { failed: true, message: "" }
  return {
    failed: true,
    message: input.code !== 0 ? "Codex 退出码 " + input.code + "；下面是引擎日志。" : "这一轮没有正常收尾；下面是引擎日志。"
  }
}
