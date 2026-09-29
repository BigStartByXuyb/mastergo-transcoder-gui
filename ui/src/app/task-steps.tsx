import { Fragment } from "react"
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react"

import { AiFillLine } from "@/app/ai-fill-line"
import { ClampText } from "@/app/clamp-text"
import { Badge } from "@/components/ui/badge"
import type { BoardTask } from "@/lib/api"

/*
 * 一个任务的流程视图：步骤与状态来自插件自己的运行登记表（续跑接着写同一份），
 * 所以一次跑停、AI 补输入、再续跑，在这里始终是同一条 12 步流水线。
 * 看板与流水线详情共用这一份渲染——同一逻辑只有一个实现。
 */

export const STEP_TEXT: Record<string, string> = {
  ok: "完成",
  running: "运行中",
  pending: "未开始",
  failed: "失败",
  skipped: "跳过"
}

export function StepFlow({ task, stepTitles }: { task: BoardTask; stepTitles: Map<string, string> }) {
  if (task.steps.length === 0) {
    return <p className="text-muted-foreground py-2 text-xs">还没有步骤登记 —— 流水线还没跑到第 1 步。</p>
  }
  // 「当时停在第几步」要按名字翻回编号：补的输入记在消费它的那一步上，两者常常不是同一步。
  const idByName = new Map(task.steps.map((step) => [step.name, step.id]))
  return (
    <ol className="flex flex-col gap-1 py-1">
      {task.steps.map((step) => {
        const Icon =
          step.status === "ok"
            ? CheckCircle2
            : step.status === "failed"
              ? XCircle
              : step.status === "running"
                ? Loader2
                : step.status === "skipped"
                  ? MinusCircle
                  : Circle
        const tone =
          step.status === "ok"
            ? "text-emerald-600"
            : step.status === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
        return (
          <Fragment key={step.id}>
            {step.aiFill && step.aiFill.filled.length > 0 && (
              <AiFillLine
                filled={step.aiFill.filled}
                note={
                  step.aiFill.stoppedAt && step.aiFill.stoppedAt !== step.name
                    ? "（当时停在第 " + (idByName.get(step.aiFill.stoppedAt) ?? "?") + " 步）"
                    : undefined
                }
              />
            )}
            <li className="flex items-start gap-2 text-xs">
              <span className="text-muted-foreground w-6 shrink-0 text-right tabular-nums">{step.id}</span>
              <Icon className={"mt-0.5 size-3.5 shrink-0 " + tone + (step.status === "running" ? " animate-spin" : "")} />
              <span className="w-44 shrink-0 truncate" title={step.name}>
                {stepTitles.get(step.name) ?? step.name}
              </span>
              <span className="text-muted-foreground w-14 shrink-0">{STEP_TEXT[step.status] ?? step.status}</span>
              <span className="text-muted-foreground w-12 shrink-0 tabular-nums">
                {step.seconds ? step.seconds + "s" : ""}
              </span>
              <span className="min-w-0 flex-1">
                {step.humanInput && <Badge variant="outline">人/AI 语义输入</Badge>}
                {step.note && <ClampText text={step.note} className="text-muted-foreground ml-2" />}
              </span>
            </li>
          </Fragment>
        )
      })}
    </ol>
  )
}
