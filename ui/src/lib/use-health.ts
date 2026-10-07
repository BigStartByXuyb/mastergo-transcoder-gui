import { useEffect, useRef, useState } from "react"

import { api, type Health } from "@/lib/api"
import { serviceUpOn } from "@/lib/describe-failure"

/*
 * 轮询 /api/health。
 * 后端版本变了（例如刚完成一次更新、指针已切）就刷新页面让前端跟上；
 * 检测失败不打扰用户，只是把状态置为不可用。
 *
 * 失败分两种，因为「服务没在跑」这句话只能对其中一种说：
 *   gone —— 请求断在半路（确认断连）：后端已经不在，关掉窗口重开一次；
 *   其它 —— 答了话却没答对（例如 /api/health 回了 500）：它还在，只是这一页读不到状态。
 * 判据只有一处：describe-failure 的 serviceUpOn（重启那条路也读它）——都问「这一次请求说明后端还在吗」。
 */
export function useHealth(intervalMs = 5000) {
  const [health, setHealth] = useState<Health | null>(null)
  const [offline, setOffline] = useState(false)
  const [gone, setGone] = useState(false)
  const seenVersion = useRef("")

  useEffect(() => {
    let stopped = false

    async function tick() {
      try {
        const payload = await api.health()
        if (stopped) return
        setHealth(payload)
        setOffline(false)
        setGone(false)
        if (seenVersion.current && payload.version && payload.version !== seenVersion.current) {
          window.location.reload()
          return
        }
        seenVersion.current = payload.version
      } catch (error) {
        if (stopped) return
        setOffline(true)
        setGone(!serviceUpOn(error))
      }
    }

    void tick()
    const timer = window.setInterval(tick, intervalMs)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [intervalMs])

  return { health, offline, gone }
}
