import { useEffect, useRef, useState } from "react"

import { api, type Health } from "@/lib/api"

/*
 * 轮询 /api/health。
 * 后端版本变了（例如刚完成一次更新、指针已切）就刷新页面让前端跟上；
 * 检测失败不打扰用户，只是把状态置为不可用。
 */
export function useHealth(intervalMs = 5000) {
  const [health, setHealth] = useState<Health | null>(null)
  const [offline, setOffline] = useState(false)
  const seenVersion = useRef("")

  useEffect(() => {
    let stopped = false

    async function tick() {
      try {
        const payload = await api.health()
        if (stopped) return
        setHealth(payload)
        setOffline(false)
        if (seenVersion.current && payload.version && payload.version !== seenVersion.current) {
          window.location.reload()
          return
        }
        seenVersion.current = payload.version
      } catch {
        if (stopped) return
        setOffline(true)
      }
    }

    void tick()
    const timer = window.setInterval(tick, intervalMs)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [intervalMs])

  return { health, offline }
}
