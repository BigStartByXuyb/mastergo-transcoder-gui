import { ArrowRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PendingPanel } from "@/app/pending-panel"
import type { BoardTask } from "@/lib/api"
import { AUTOMATION_LABEL } from "@/lib/task-form"

/*
 * 待确认卡片：任务停在插件的语义停点（图标命名 / 译文）时出现。
 * 「要不要登记」是插件机械判定的；「叫什么名字、怎么翻译」只能人或 AI 给，这几步永远绕不过去。
 */

type Props = {
  task: BoardTask
  automation: string
  counts: { icons: number; translations: number; total: number }
  onResumed: () => void
}

export function TaskPendingCard(props: Props) {
  const { task, automation, counts } = props
  return (
    <Card className="border-amber-500/60">
      <CardHeader>
        <CardTitle>等待语义输入 —— 这不是错误</CardTitle>
        <CardDescription>
          流水线按设计停在这里。「要不要登记」由插件机械判定；「叫什么名字、怎么翻译」才是语义判断，
          只能由人或 AI 给——这几步永远绕不过去。补完从断点继续。
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {counts.icons > 0 && <Badge variant="secondary">图标待办 {counts.icons} 条</Badge>}
          {counts.translations > 0 && <Badge variant="secondary">文案待办 {counts.translations} 条</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.hash = "review"
              }}
            >
              <ArrowRight className="size-4" />
              在独立页面打开
            </Button>
            <span className="text-muted-foreground text-xs">
              当前自动化层级：{AUTOMATION_LABEL[automation] ?? automation}
              {automation === "assist" ? "（AI 自动出候选，你确认后继续）" : ""}
              {automation === "auto" ? "（AI 自动出候选并直接继续）" : ""}
              {automation === "off" ? "（不叫模型，全人工填）" : ""}
            </span>
          </div>
          <PendingPanel
            projectRoot={task.workDir}
            target={task.request.target}
            runId={task.jobId}
            reloadKey={task.id + ":" + task.updatedAt}
            automation={automation}
            onResumed={props.onResumed}
          />
        </div>
      </CardContent>
    </Card>
  )
}
