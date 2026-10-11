import type { ReactNode } from "react"

import { AiFillLine } from "@/app/ai-fill-line"
import { ClampText } from "@/app/clamp-text"
import { FailureNote } from "@/app/failure-note"
import { StepIcon, STEP_TEXT } from "@/app/task-steps"
import type { StepRow } from "@/lib/step-rows"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { BoardTask, PipelineStep } from "@/lib/api"

/*
 * 一步的界面外壳：这一步是谁、跑到什么状态、停在这里的原因与修法（都在插件契约里），
 * 以及这一步要你补的输入（由调用方作为 children 挂进来 —— 每步的输入面板各不相同）。
 */

export function StepCard({
  row,
  contractStep,
  failure,
  children
}: {
  row: StepRow
  /** 这一步的契约（可能还没读到契约，那就只显示登记表里有的）。 */
  contractStep: PipelineStep | null
  /** 这一步的停点 / 失败（没有就是 null）：说明由 FailureNote 一处渲染，这里不再排一遍。 */
  failure: BoardTask["failure"]
  /**
   * 这一步要人补的输入（每一种各不相同）。调用方一定会给：没有面板时给 false / null，
   * 这一块就不出现（要不要给一句「这一步没有要你补的输入」，由调用方决定）。
   */
  children: ReactNode
}) {
  const failed = row.status === "failed"
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground tabular-nums">第 {row.id} 步</span>
          {row.title}
          <StepIcon status={row.status} />
          <Badge variant={failed ? "destructive" : row.status === "ok" ? "secondary" : "outline"}>
            {STEP_TEXT[row.status] ?? row.status}
          </Badge>
          {row.seconds > 0 && <span className="text-muted-foreground text-xs tabular-nums">{row.seconds}s</span>}
          {row.humanInput && <Badge variant="outline">人/AI 语义输入</Badge>}
        </CardTitle>
        {contractStep && (
          <CardDescription className="text-xs">
            输入：{contractStep.Inputs.join("；")}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {row.aiFill.length > 0 && <AiFillLine filled={row.aiFill} note={row.aiFillNote || undefined} />}
        {row.note && <ClampText text={row.note} className="text-muted-foreground text-xs" />}

        {/* 步骤界面里不写「去哪儿继续」那句（inStepView），resumable 只为满足必填：这里用不到它。 */}
        <FailureNote failure={failure} contractStep={contractStep} stopStepNumber={row.id} resumable={false} inStepView />

        {children}
      </CardContent>
    </Card>
  )
}
