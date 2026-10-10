import { CheckCircle2, Circle, LayoutList, Loader2, MinusCircle, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/*
 * 步骤条：一条任务的每一步（顺序与标题来自插件自己的步骤契约），每步给状态、耗时与「停在这里」的标记。
 * 点某一步 → 详情区只显示那一步的界面（见 app/pipeline-page.tsx）；点「任务」回到总览。
 *
 * 一份数据两种呈现（步骤条 / 步骤面板的头）都从这里取，界面不自己推「跑到哪一步了」。
 */

export const STEP_TEXT: Record<string, string> = {
  ok: "完成",
  running: "运行中",
  pending: "未开始",
  failed: "失败",
  skipped: "跳过"
}

export type StepRow = {
  id: number
  name: string
  title: string
  status: string
  seconds: number
  humanInput: boolean
  /** 这一步被 AI 补过输入（续跑时记在消费它的那一步上）。 */
  aiFill: string[]
  /** 补输入时实际停在哪一步的一句话（与上面那一步常常不是同一步）。 */
  aiFillNote: string
  note: string
}

/** 这一段（步骤）该用哪个图标与颜色：完成 / 失败 / 运行中 / 跳过 / 未开始。 */
function StepIcon({ status, className }: { status: string; className?: string }) {
  const Icon =
    status === "ok" ? CheckCircle2 : status === "failed" ? XCircle : status === "running" ? Loader2 : status === "skipped" ? MinusCircle : Circle
  const tone =
    status === "ok"
      ? "text-emerald-600"
      : status === "failed"
        ? "text-destructive"
        : status === "running"
          ? "text-primary"
          : "text-muted-foreground"
  return <Icon className={cn("size-3.5 shrink-0", tone, className, status === "running" && "animate-spin")} />
}

export function StepRail(props: {
  rows: StepRow[]
  /** 现在看的是哪一步（空串 = 任务总览）。 */
  current: string
  /** 这次运行停在哪一步（空串 = 没停）。 */
  stopStep: string
  onPick: (name: string) => void
  onPickOverview: () => void
}) {
  return (
    <nav className="flex shrink-0 flex-col gap-0.5 lg:w-64">
      <button
        type="button"
        onClick={props.onPickOverview}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
          props.current === "" ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent/60"
        )}
      >
        <LayoutList className="size-3.5 shrink-0" />
        任务总览
      </button>
      {props.rows.map((row) => {
        const active = row.name === props.current
        const stopped = row.name === props.stopStep
        return (
          <button
            key={row.name}
            type="button"
            onClick={() => props.onPick(row.name)}
            title={row.title}
            className={cn(
              "flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left",
              active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
            )}
          >
            <span className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground w-4 shrink-0 text-right tabular-nums">{row.id}</span>
              <StepIcon status={row.status} />
              <span className="min-w-0 flex-1 truncate">{row.title}</span>
              {stopped && <Badge variant={row.status === "failed" ? "destructive" : "secondary"}>停这里</Badge>}
            </span>
            <span className="text-muted-foreground flex items-center gap-2 pl-6 text-[0.7rem]">
              <span>{STEP_TEXT[row.status] ?? row.status}</span>
              {row.seconds > 0 && <span className="tabular-nums">{row.seconds}s</span>}
              {row.humanInput && <span>人/AI 语义输入</span>}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

export { StepIcon }
