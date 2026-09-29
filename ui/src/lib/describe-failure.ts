import { ApiFailure } from "@/lib/api"

/*
 * 失败 → 界面文案。
 * 后端错误自带 hint（怎么修），丢掉它就只剩「失败」两个字；非 ApiFailure 的异常原文照给。
 * 全仓库只有这一份实现：每个 catch 都调它，不允许各写各的拼法。
 */
export function describeFailure(error: unknown): string {
  if (error instanceof ApiFailure) return error.hint ? error.message + "：" + error.hint : error.message
  return String(error)
}
