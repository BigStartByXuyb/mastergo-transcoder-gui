import { useEffect, useState } from "react"

/*
 * 本地记住的一份界面状态：读一次起步，之后每改一次就写回。
 *
 * 读写实现只有 lib/storage.ts 一处，「什么时候写回」也只有这一处 —— 两张「新建任务」表单、
 * 看板筛选、只看生效都走它：各写一段一样的 setState + 落盘，就会出现「一处记得、一处填一半切走就没了」。
 */
export function useRemembered<T>(read: () => T, write: (value: T) => void) {
  const [value, setValue] = useState<T>(read)

  useEffect(() => {
    write(value)
  }, [value, write])

  return [value, setValue] as const
}
