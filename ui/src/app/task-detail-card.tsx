import { GitMerge, Loader2, RotateCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FailureNote } from "@/app/failure-note"
import { MergeConflicts } from "@/app/merge-conflicts"
import type { BoardTask, PipelineStep } from "@/lib/api"
import { boardStateVariant } from "@/lib/board-state"
import { canResume } from "@/lib/task-state"

/*
 * 任务总览卡片：状态、工作目录、可做的动作（续跑 / 合并 / 冲突裁决）。
 * 每一步的进度与那一步要补的输入在左边的步骤条与步骤界面里（app/step-card.tsx）；
 * 但「停在哪一步、为什么停」要在这里也能读到 —— 有些停点根本没有具体某一步可指（启动前的失败），
 * 那种时候界面不该让人去左边找一个不存在的标记。
 */

type Props = {
  task: BoardTask
  /** 停点那一步的契约（能定位到某一步时才有）：它的 Failures / Recovery 就是插件给的修法。 */
  contractStep: PipelineStep | null
  /** 停点那一步在流水线里的序号（定位不到时是 0）。 */
  stopStepNumber: number
  /** 这次运行各步是不是都跑完了（跑完还停在「待处理」就是等合并）。 */
  allStepsDone: boolean
  busy: string
  onResume: () => void
  onMerge: () => void
  onResolve: (path: string, pick: "mine" | "main" | "clear") => Promise<void>
}

export function TaskDetailCard(props: Props) {
  const { task, busy } = props
  // 同一次渲染里算一遍就够：按钮与失败说明读的是同一个结论。
  const resumable = canResume(task)
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
          {/*
            按钮只说「有没有断点」：具体从哪一步续由续跑计划在点下去那一刻算（lib/board.js 的 planResume），
            结果写在完成提示里（use-task-actions）—— 那是唯一一处说「实际从哪儿续」的地方，
            快照里那个步名只是同一判据的展示面，不拿来当承诺。
          */}
          {resumable && (
            <Button size="sm" disabled={busy === "resume"} onClick={props.onResume}>
              {busy === "resume" ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
              {task.resumeStep ? "从断点继续" : "重跑一遍"}
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
        {props.allStepsDone && (task.state === "ready" || task.state === "conflict") && (
          <p className="text-sm">
            {task.state === "conflict"
              ? "流水线各步都跑完了，产物也写好了；现在卡在「合并回工程」那一步 —— 下面把冲突逐文件选一遍，再点「重新合并」。"
              : "流水线各步都跑完了，产物也写好了；现在等的是「合并回工程」（点下面的「合并回工程」）。"}
          </p>
        )}
        {task.merge && task.merge.conflicts.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">
              冲突是「合并回工程」这一步里的：主工程与这次产物在同一个文件上都改过。逐条选一边（或撤销选择），
              选完点「重新合并」。选「保留主工程」的那几条，这个文件这次一个字节都不会写。
            </p>
            <MergeConflicts
              conflicts={task.merge.conflicts}
              resolutions={task.resolutions}
              busy={busy !== ""}
              onPick={props.onResolve}
            />
          </div>
        )}
        <FailureNote
          failure={task.failure}
          contractStep={props.contractStep}
          stopStepNumber={props.stopStepNumber}
          resumable={resumable}
        />
      </CardContent>
    </Card>
  )
}
