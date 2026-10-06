import { useCallback, useEffect, useRef } from "react"

import { describeFailure } from "@/lib/describe-failure"

/*
 * 按「在传输中」换节拍地轮询一份状态：空闲慢、进行中快。
 *
 * 四张卡片都用它（程序更新、Codex 引擎、运行时、插件安装）：节拍只有这一处，改一处全都跟着变；
 * 组件只给「怎么取、拿到放哪儿、失败放哪儿」，定时器与卸载守卫都在这里。
 * 回调放 ref 里：定时器不跟着组件重渲染重挂，晚到的响应也不会写进已卸载的界面。
 */

/** 空闲时的复查间隔：没有传输时慢一点，够用又不吵远端。 */
export const IDLE_POLL_MS = 15000
/** 正在传输时的间隔：进度与阶段要跟得上。 */
export const WORKING_POLL_MS = 1500

export function useStatusPoll<T>(settings: {
  /** 取一次状态。 */
  load: () => Promise<T>
  onData: (payload: T) => void
  onError: (message: string) => void
  /** 正在传输：决定这一轮用哪个节拍。 */
  working: boolean
  /** 进行中的节拍；默认 WORKING_POLL_MS。 */
  workingMs?: number
}): { reload: () => Promise<T | null> } {
  const latest = useRef(settings)
  latest.current = settings

  // 卸载之后不再回写状态；StrictMode 的「挂载 → 卸下 → 再挂载」要能重新放行。
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // 取回来那份原样交回调用方（手动刷新那条路要按它说话）；失败与「已经卸下」都回 null。
  const tick = useCallback(async function (): Promise<T | null> {
    try {
      const payload = await latest.current.load()
      if (!alive.current) return null
      latest.current.onData(payload)
      return payload
    } catch (error) {
      if (!alive.current) return null
      latest.current.onError(describeFailure(error))
      return null
    }
  }, [])

  useEffect(() => {
    void tick()
    const interval = settings.working ? (settings.workingMs ?? WORKING_POLL_MS) : IDLE_POLL_MS
    const timer = window.setInterval(() => void tick(), interval)
    return () => window.clearInterval(timer)
  }, [tick, settings.working, settings.workingMs])

  // 手动立刻刷一次（改完设置不想等下一轮）：与轮询走同一条取数路径（卸载守卫也一并走这条）。
  return { reload: tick }
}
