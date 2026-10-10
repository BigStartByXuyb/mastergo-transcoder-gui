import { useEffect, useState } from "react"

import { api, type Pending } from "@/lib/api"

/*
 * 某个任务当前要人/AI 补的语义输入清单（图标命名 / 译文 / 布局确认）。
 * 只有任务停下来（不在跑）时才有意义：跑着的时候清空，免得把上一轮的清单挂在行上。
 */

export function usePending(input: { workDir: string; target: string; running: boolean; reloadKey: string }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const { workDir, target, running, reloadKey } = input

  useEffect(() => {
    if (!workDir || running) {
      setPending(null)
      return
    }
    let stopped = false
    api
      .pending(workDir, target)
      .then((payload) => {
        if (!stopped) setPending(payload.pending)
      })
      .catch(() => {
        if (!stopped) setPending(null)
      })
    return () => {
      stopped = true
    }
  }, [workDir, target, running, reloadKey])

  return pending
}
