import type { Pending } from "@/lib/api"

/*
 * 任务状态与待确认条目的判定：看板与流水线详情共用一份，不允许两处各写一套状态列表。
 * 轮询节拍也放这里 —— 界面刷新节奏属于同一件事。
 */

export const POLL_MS = 1500

/*
 * 待确认清单页的节拍比看板慢一拍：它读的是磁盘上的清单（谁要填什么），
 * 不跟实时日志，快轮询只是白读盘。
 */
export const REVIEW_POLL_MS = 2000

/* 正在占用执行额度：任务在推进，界面不让再起同一条流水线。 */
const RUNNING_STATES = ["preparing", "running", "merging"]

/*
 * 占了看板这一位、不能再起同一个任务的状态：排队与待确认也占着位子。
 * 与 RUNNING_STATES 是两个具名判定，不是同一个集合的两种叫法。
 */
const OCCUPIED_STATES = ["queued", "preparing", "running", "waiting", "merging"]

/* 产物已经落地的状态：合并中也算 —— 产物写完了，正在回写主工程。 */
const FINISHED_STATES = ["ready", "merging", "merged", "conflict"]

/*
 * 已经落地、可以先收起的任务：跑完 / 失败 / 停止都走完了，冲突也已经出了报告。
 * 「落地」不等于「不会再变」——冲突还能靠「重新合并」再试一次，所以它在这里，
 * 但看板不给它「已结束」的说法。
 */
export const SETTLED_STATES = ["merged", "failed", "stopped", "conflict"]

export function isBusyState(state: string): boolean {
  return RUNNING_STATES.includes(state)
}

export function occupiesSlot(state: string): boolean {
  return OCCUPIED_STATES.includes(state)
}

/* 正在合并：产物已写完、正在回写主工程，这时不给「停止」（停也停不了一半）。 */
export function isMerging(state: string): boolean {
  return state === "merging"
}

export function isFinishedState(state: string): boolean {
  return FINISHED_STATES.includes(state)
}

export function isSettled(state: string): boolean {
  return SETTLED_STATES.includes(state)
}

/*
 * 能不能给「停止」：占着这一位、且不在合并中（合并停不了一半）。
 * 看板与流水线共用这一条 —— 两处各写一遍，就会出现「看板藏了、流水线还显示」。
 */
export function canStop(state: string): boolean {
  return occupiesSlot(state) && !isMerging(state)
}

/** 待确认条目计数：命名表与译文各自独立，界面按这两类分别给徽标。 */
export function waitingCounts(pending: Pending | null): { icons: number; translations: number; total: number } {
  const icons = pending?.icons.available && pending.icons.needsNaming ? pending.icons.mustName.length : 0
  const translations =
    pending?.translations.available && pending.translations.needsTranslation
      ? pending.translations.pendingTranslations.length
      : 0
  return { icons, translations, total: icons + translations }
}
