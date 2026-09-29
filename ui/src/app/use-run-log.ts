import { useEffect, useRef, useState } from "react"

import { api, type Job } from "@/lib/api"
import { POLL_MS } from "@/lib/task-state"

/*
 * 一次运行的实时状态与日志。
 *
 * 换任务或续跑（jobId 变了）时从零开始拉：否则两次运行的输出会拼在一起，看着像同一次跑了两遍。
 * 轮询只在运行中开着，跑完就停 —— 已经结束的运行状态不会再变。
 */
export function useRunLog(jobId: string) {
  const [job, setJob] = useState<Job | null>(null)
  const [logText, setLogText] = useState("")
  const offsetRef = useRef(0)
  const logRef = useRef<HTMLPreElement | null>(null)

  function reset() {
    setLogText("")
    offsetRef.current = 0
  }

  useEffect(() => {
    reset()
    if (!jobId) {
      setJob(null)
      return
    }
    let alive = true
    api
      .runStatus(jobId)
      .then((payload) => {
        if (alive) setJob(payload.job)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [jobId])

  const live = job !== null && (job.state === "running" || job.state === "stopping")

  useEffect(() => {
    if (!jobId || !live) return
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const status = await api.runStatus(jobId)
          if (status.job) setJob(status.job)
          const slice = await api.runLog(jobId, offsetRef.current)
          if (slice.truncated) setLogText(slice.text)
          else if (slice.text) setLogText((current) => current + slice.text)
          offsetRef.current = slice.next
        } catch {
          /* 轮询失败不打断界面 */
        }
      })()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [jobId, live])

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [logText])

  return { job, setJob, logText, logRef, reset }
}
