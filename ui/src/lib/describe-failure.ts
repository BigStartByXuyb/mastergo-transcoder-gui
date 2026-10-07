import { ApiFailure } from "@/lib/api"

/*
 * 失败 → 一句话界面文案。两种输入，同一种拼法（原因 + 怎么修）：
 *   failureText：状态里内嵌的失败（更新、引擎状态都带 {message, hint}）
 *   describeFailure：抛出来的异常（后端错误自带 hint；普通异常只有 message）
 * 唯一的例外是「请求断在半路」——那说明后端已经不在了，不报技术原文，只说去哪儿看（见 SERVICE_GONE_NOTE）。
 * 需要把 message 与 hint 分开排版的场合（控件查询页把 hint 单独一行）不算这里管，
 * 其余「把失败说成一句话」的地方都调这里，不允许各写各的拼法 —— 分隔符也只有这一处说了算。
 */

/*
 * 后端已经答不上话时给用户的那一句：不说技术原文（连不上本地服务 / Failed to fetch 都不指向下一步），
 * 只说「去哪儿看原因、怎么恢复」。顶栏「服务未就绪」、四张卡片的轮询失败、切版本没起来都读这一处 ——
 * 对用户是同一件事，不该有两种说法；原始异常留给诊断入口。
 */
export const SERVICE_GONE_NOTE = "服务没在跑：看一下客户端那个窗口里打印的原因；把它关掉再打开一次。"

/*
 * 「这个失败说明后端还在吗」只有这一处：请求断在半路（api 层一律折成 OFFLINE）＝已经不在；
 * 后端答了话（哪怕是拒绝，像有任务在跑、本地那份和清单对不上）＝还在。
 * 谁要据此决定「还要不要把人带到某一页 / 该不该按没了说」，都读这一条。
 *
 * 与「页面现在连不连得上」分清楚：那是 use-health 每 5 秒轮询自己判的持续可用性（顶栏据此说
 * 「服务未就绪」），这是单次请求的结果；两问不同、各判各的，但真到了「后端没了」都说同一句。
 */
export function serviceUpOn(error: unknown): boolean {
  return !(error instanceof ApiFailure && error.code === "OFFLINE")
}

export function failureText(failure: { message: string; hint?: string }): string {
  return failure.hint ? failure.message + "：" + failure.hint : failure.message
}

export function describeFailure(error: unknown): string {
  // 后端已经答不上话：技术原文（连不上本地服务 / Failed to fetch）不指向下一步，换那一句。
  if (!serviceUpOn(error)) return SERVICE_GONE_NOTE
  if (error instanceof ApiFailure) return failureText(error)
  // 普通异常只给 message：界面要的是原因，不是 "Error: " 前缀。
  if (error instanceof Error) return error.message
  return String(error)
}
