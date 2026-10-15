import { useEffect, useRef } from "react"

/*
 * 卸载之后不再回写状态：轮询、读清单这类异步落状态的地方都用它。
 *
 * 为什么要单独一处：StrictMode 下会「挂载 → 卸下 → 再挂载」，守卫必须在重新挂载时放行，
 * 否则首次读取永远被拦掉。这套语义只写这一份，别处的异步回写不各写一遍 ref + effect。
 */
export function useAlive() {
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  return alive
}
