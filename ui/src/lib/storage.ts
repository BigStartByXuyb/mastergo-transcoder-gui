/*
 * 页面上一次填的表单存在 localStorage 里。读写都必须能容忍“存储不可用 / 存的是坏 JSON”：
 * 隐私模式下 localStorage 会抛异常，旧版本写进去的字段也可能已经改名。
 */

export function readStored<T>(key: string, fallback: T, pick: (raw: Record<string, unknown>) => T): T {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}")
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback
    return pick(raw as Record<string, unknown>)
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存储不可用就只影响这次记忆，不该打断操作 */
  }
}

/*
 * 这个键存过没有。readStored 把「没存过」也当成一个空对象走 pick，
 * 所以要区分「存过、值就是默认」与「压根没存过」（换过键、要回落旧值）时用这个先问一句。
 */
export function hasStored(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null
  } catch {
    return false
  }
}
