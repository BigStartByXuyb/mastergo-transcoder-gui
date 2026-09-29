import type { Pending } from "@/lib/api"

/*
 * 任务状态与待确认条目的判定：看板与流水线详情共用一份，不允许两处各写一套状态列表。
 * 轮询节拍也放这里 —— 界面刷新节奏属于同一件事。
 */

export const POLL_MS = 1500

/* 正在占用执行额度：流水线详情按它显示「停止」。 */
const RUNNING_STATES = ["preparing", "running", "merging"]

/*
 * 占了看板这一位、不能再起同一个任务的状态：排队与待确认也占着位子。
 * 与 RUNNING_STATES 是两个具名判定，不是同一个集合的两种叫法。
 */
const OCCUPIED_STATES = ["queued", "preparing", "running", "waiting", "merging"]

/* 已经跑完、可以看待办与产物的状态。 */
const FINISHED_STATES = ["ready", "merging", "merged", "conflict"]

export function isBusyState(state: string): boolean {
  return RUNNING_STATES.includes(state)
}

export function occupiesSlot(state: string): boolean {
  return OCCUPIED_STATES.includes(state)
}

export function isFinishedState(state: string): boolean {
  return FINISHED_STATES.includes(state)
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
