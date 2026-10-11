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
export const RUNNING_STATES = ["preparing", "running", "merging"]

/*
 * 占了看板这一位、不能再起同一个任务的状态：排队与待确认也占着位子。
 * 与 RUNNING_STATES 是两个具名判定，不是同一个集合的两种叫法。
 */
const OCCUPIED_STATES = ["queued", "preparing", "running", "waiting", "merging"]

/* 产物已写完、清单可以看的状态：合并中算（产物写完了，正在回写主工程）。 */
const PRODUCT_STATES = ["ready", "merging", "merged", "conflict"]

/* 停下来的三种：失败、等语义输入、被停掉。只有它们身上还有「断点」可续。 */
const RESUMABLE_STATES = ["failed", "waiting", "stopped"]

/*
 * 停下来等人/等合并的任务：侧边栏区域行的「待处理」与看板的状态筛选都用这一份，
 * 不许各写一套 —— 两处口径不一致时，人会照着数字去找，然后找不到。
 */
export const ATTENTION_STATES = ["waiting", "ready", "conflict", "failed", "stopped"]

/*
 * 真的结束了：跑完 / 失败 / 停止。看板「清掉已结束」只清这些 ——
 * 冲突不属于已结束（它等着人或 AI 处理，还能重新合并再试），清掉会把待办的行一起藏掉。
 */
export const FINISHED_STATES = ["merged", "failed", "stopped"]

/* 可以先收起的：已结束的 + 冲突（冲突也已出报告，想放下时可以单独移除这一行）。 */
export const SETTLED_STATES = [...FINISHED_STATES, "conflict"]

export function isBusyState(state: string): boolean {
  return RUNNING_STATES.includes(state)
}

export function occupiesSlot(state: string): boolean {
  return OCCUPIED_STATES.includes(state)
}

/*
 * 在跑：占着这一位、又不是停在语义停点上（「等待」那一档正是等人补输入的时候）。
 * 「写回并续跑」（待确认页与布局确认面板的「确认并继续」）只在不在跑的时候给 ——
 * 跑着的时候再来一次会起第二次运行。
 */
export function isInFlight(state: string): boolean {
  return occupiesSlot(state) && state !== "waiting"
}

/*
 * 「运行中不给续跑」这句说法的唯一一处：布局确认与待确认面板的「写入并续跑」都挂它。
 * 判据是上面的 isInFlight；说法只写一处，两个入口不会一个拦一个不拦、也不会各说各的。
 */
export function inFlightNote(action: string): string {
  return "流水线正在跑：等它停下来再点「" + action + "」。"
}

/* 正在合并：产物已写完、正在回写主工程，这时不给「停止」（停也停不了一半）。 */
export function isMerging(state: string): boolean {
  return state === "merging"
}

export function hasProducts(state: string): boolean {
  return PRODUCT_STATES.includes(state)
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

/*
 * 能不能「从断点继续」：只在这三种停法上有意义 —— 失败、等语义输入、被停掉。
 * 跑完的没有断点，排队中的还没跑过（那是「开始」）。
 * 工作目录是续跑要用的：插件登记表与产物都在那儿，没有它续起来只是空跑。
 *
 * 失败还要分两种：跑到某一步才失败（failure.stepName 有值，那一步就是断点，续得下去）；
 * 与「还没进入任何一步就没跑起来」（链接 / 页面名这类输入不对，插件根本没开始跑）——
 * 后者没有断点：再点「继续」只会拿同一份输入把同一句错再报一遍，所以要先把输入改对。
 */
export function canResume(task: {
  state: string
  workDir: string
  failure?: { stepName?: string } | null
}): boolean {
  if (!RESUMABLE_STATES.includes(task.state) || !task.workDir.trim()) return false
  if (task.state !== "failed") return true
  return Boolean(task.failure && task.failure.stepName)
}

/*
 * 待补全面板自己处理的那两节的条数：各自的 waiting 由后端 lib/pending.js 算一次
 *（图标那节还含命名表写歪的旧下标与重名组），这里只取数、不再按 needsXxx 重算一遍。
 * 布局那一节不在这里：它归布局确认面板（后端的 layoutSection），界面不把三节混成一个数。
 */
export function waitingCounts(pending: Pending | null): { icons: number; translations: number } {
  return {
    icons: pending?.icons.waiting ?? 0,
    translations: pending?.translations.waiting ?? 0
  }
}

/*
 * 待补全面板自己处理的那两节（图标 + 译文）的条数：布局那一节归布局确认面板，
 * 「这一页有没有图标/文案要补」只看这一个数 —— 面板的提交门禁与看板那张待确认卡都读它。
 */
export function pendingInputCount(counts: { icons: number; translations: number }): number {
  return counts.icons + counts.translations
}
