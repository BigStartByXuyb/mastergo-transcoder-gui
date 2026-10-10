import { GitMerge, Loader2, RotateCw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MergeConflicts } from "@/app/merge-conflicts"
import type { BoardTask } from "@/lib/api"
import { boardStateVariant } from "@/lib/board-state"
import { canResume } from "@/lib/task-state"

/*
 * 任务总览卡片：状态、工作目录、可做的动作（续跑 / 合并 / 冲突裁决）。
 * 每一步的进度、失败原因与那一步要补的输入都在左边的步骤条与步骤界面里（app/step-card.tsx），
 * 这里不复述一遍。
 */

type Props = {
  task: BoardTask
  busy: string
  onResume: () => void
  onMerge: () => void
  onResolve: (path: string, pick: "mine" | "main" | "clear") => Promise<void>
}

export function TaskDetailCard(props: Props) {
  const { task, busy } = props
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          任务详情
          <Badge variant={boardStateVariant(task.state)}>{task.stateLabel}</Badge>
          <Badge variant="outline">{task.request.mode}</Badge>
          {task.request.target && <Badge variant="outline">Target {task.request.target}</Badge>}
          {task.request.ui && <Badge variant="outline">UI {task.request.ui}</Badge>}
          {task.request.stopAfter && <Badge variant="outline">停在 {task.request.stopAfter}</Badge>}
        </CardTitle>
        <CardDescription className="break-all">
          工作目录 {task.workDir || "（还没建）"}
          {task.request.projectRoot ? " · 合并回 " + task.request.projectRoot : ""}
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {canResume(task) && (
            <Button size="sm" disabled={busy === "resume"} onClick={props.onResume}>
              {busy === "resume" ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
              从断点继续
            </Button>
          )}
          {(task.state === "ready" || task.state === "conflict") && (
            <Button size="sm" disabled={busy !== ""} onClick={props.onMerge}>
              <GitMerge className="size-4" />
              {task.state === "conflict" ? "重新合并" : "合并回工程"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {task.merge && task.merge.conflicts.length > 0 && (
          <MergeConflicts
            conflicts={task.merge.conflicts}
            resolutions={task.resolutions}
            busy={busy !== ""}
            onPick={props.onResolve}
          />
        )}
        {task.failure && (
          <Alert variant={task.failure.kind === "error" ? "destructive" : "default"}>
            <AlertTitle>
              {task.failure.kind === "error"
                ? "这一步失败了：" + (task.failure.title || task.failure.stepName)
                : "停在语义判断点，不是错误：" + (task.failure.title || task.failure.stepName)}
            </AlertTitle>
            <AlertDescription className="text-xs">
              原因、可能的原因与修法在左边那一步的界面里（点左侧「停这里」的那一步）。
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
