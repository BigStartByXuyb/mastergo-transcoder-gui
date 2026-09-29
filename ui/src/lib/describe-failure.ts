import { ApiFailure } from "@/lib/api"

/*
 * 失败 → 一句话界面文案。
 * 后端错误自带 hint（怎么修），丢掉它就只剩「失败」两个字；普通异常只给 message。
 * 需要把 message 与 hint 分开排版的场合（控件查询页把 hint 单独一行）不算这里管，
 * 其余「把失败说成一句话」的地方都调这里，不允许各写各的拼法。
 */
export function describeFailure(error: unknown): string {
  if (error instanceof ApiFailure) return error.hint ? error.message + "：" + error.hint : error.message
  // 普通异常只给 message：界面要的是原因，不是 "Error: " 前缀。
  if (error instanceof Error) return error.message
  return String(error)
}
