import type { ReactNode } from "react"

import { AiFillLine } from "@/app/ai-fill-line"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { StepIcon, STEP_TEXT, type StepRow } from "@/app/task-steps"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { PipelineStep } from "@/lib/api"

/*
 * 一步的界面外壳：这一步是谁、跑到什么状态、停在这里的原因与修法（都在插件契约里），
 * 以及这一步要你补的输入（由调用方作为 children 挂进来 —— 每步的输入面板各不相同）。
 */

export function StepCard(props: {
  row: StepRow
  /** 这一步的契约（可能还没读到契约，那就只显示登记表里有的）。 */
  contractStep: PipelineStep | null
  /** 这一步的日志路径（停在这里 / 失败在这一步时才有）。 */
  logPath: string
  failureMessage: string
  children?: ReactNode
}) {
  const row = props.row
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
        {props.contractStep && (
          <CardDescription className="text-xs">
            输入：{props.contractStep.Inputs.join("；")}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {row.aiFill.length > 0 && <AiFillLine filled={row.aiFill} note={row.aiFillNote || undefined} />}
        {row.note && <ClampText text={row.note} className="text-muted-foreground text-xs" />}

        {(failed || props.failureMessage) && (
          <Alert variant={failed ? "destructive" : "default"}>
            <AlertTitle>{failed ? "这一步失败了" : "这一步停在语义判断点，不是错误"}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              {props.failureMessage && <ClampText text={props.failureMessage} />}
              {props.logPath && (
                <span className="text-muted-foreground text-xs">
                  这一步的日志：<IdentifierText text={props.logPath} />
                </span>
              )}
              {props.contractStep && (
                <>
                  <div>
                    <div className="text-xs font-medium">可能的原因</div>
                    <ul className="list-disc pl-5 text-xs">
                      {props.contractStep.Failures.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-medium">修好后怎么继续</div>
                    <ul className="list-disc pl-5 text-xs">
                      {props.contractStep.Recovery.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        {props.children ?? (
          <p className="text-muted-foreground text-sm">
            这一步没有要你补的输入：它的产物由流水线自己产出，看下面的日志与产物即可。
          </p>
        )}
      </CardContent>
    </Card>
  )
}
