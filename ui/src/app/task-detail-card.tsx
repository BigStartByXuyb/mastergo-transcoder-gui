import { GitMerge, Loader2, RotateCw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { StepFlow } from "@/app/task-steps"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import type { BoardTask, PipelineStep } from "@/lib/api"
import { boardStateVariant } from "@/lib/board-state"
import { isBusyState } from "@/lib/task-state"

/*
 * 任务详情卡片：状态、工作目录、可做的动作（续跑 / 合并）、失败原因与 12 步进度。
 * 失败原因优先给契约里的「可能的原因 / 修好后怎么继续」——那两句是插件自己的口径。
 */

type Props = {
  task: BoardTask
  contractStep: PipelineStep | null
  stepTitles: Map<string, string>
  busy: string
  onResume: () => void
  onMerge: () => void
}

export function TaskDetailCard(props: Props) {
  const { task, contractStep, stepTitles, busy } = props
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
          {!isBusyState(task.state) && task.jobId && (
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.location.hash = "board"
            }}
          >
            在看板里看
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {task.failure && (
          <Alert variant={task.failure.kind === "error" ? "destructive" : "default"}>
            <AlertTitle>
              {task.failure.kind === "error"
                ? "失败：" + (task.failure.title || task.failure.stepName)
                : "停在语义判断点，不是错误：" + (task.failure.title || task.failure.stepName)}
            </AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              {task.failure.message && <ClampText text={task.failure.message} />}
              {task.failure.logPath && (
                <span className="text-muted-foreground text-xs">
                  这一步的日志：<IdentifierText text={task.failure.logPath} />
                </span>
              )}
              {contractStep && (
                <>
                  <div>
                    <div className="text-xs font-medium">可能的原因</div>
                    <ul className="list-disc pl-5 text-xs">
                      {contractStep.Failures.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-medium">修好后怎么继续</div>
                    <ul className="list-disc pl-5 text-xs">
                      {contractStep.Recovery.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}
        <StepFlow task={task} stepTitles={stepTitles} />
      </CardContent>
    </Card>
  )
}
