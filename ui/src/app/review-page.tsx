import { useEffect, useState } from "react"

import { PendingPanel } from "@/app/pending-panel"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"

/*
 * 待确认页：独立入口。
 * 面板本身与「流水线页停下时内嵌的那一块」是同一个组件 —— 两处不各写一份。
 */
export function ReviewPage() {
  const [projectRoot, setProjectRoot] = useState("")
  const [target, setTarget] = useState("")
  const [runId, setRunId] = useState("")
  const [automation, setAutomation] = useState("assist")

  useEffect(() => {
    api
      .runStatus()
      .then((payload) => {
        const job = payload.job
        if (!job) return
        setRunId(job.id)
        if (job.request.projectRoot) setProjectRoot(job.request.projectRoot)
        if (job.request.target) setTarget(job.request.target)
      })
      .catch(() => undefined)
    api
      .settingsGet()
      .then((payload) => setAutomation(payload.settings.automation))
      .catch(() => undefined)
  }, [])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>待确认</CardTitle>
          <CardDescription>
            流水线停在语义判断点时，这里列出它要人/AI 补的输入。写回后从断点继续。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="review-project">工程目录</Label>
            <Input
              id="review-project"
              spellCheck={false}
              value={projectRoot}
              onChange={(event) => setProjectRoot(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="review-target">页面 Target</Label>
            <Input
              id="review-target"
              spellCheck={false}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {projectRoot.trim() && target.trim() ? (
        <Card>
          <CardContent className="pt-6">
            <PendingPanel
              projectRoot={projectRoot.trim()}
              target={target.trim()}
              runId={runId}
              automation={automation}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-muted-foreground text-sm">填上工程目录与页面 Target，或先跑一次流水线。</p>
      )}
    </div>
  )
}
