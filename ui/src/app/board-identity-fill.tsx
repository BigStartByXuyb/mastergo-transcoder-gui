import { Loader2, Sparkles } from "lucide-react"

import { IdentityCandidateButton } from "@/app/identity-candidate-button"
import type { FillRow } from "@/app/use-identity-fill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { IdentityCandidate } from "@/lib/api"
import { linkLabel } from "@/lib/board-items"
import { AUTOMATION_LABEL } from "@/lib/task-form"

/*
 * 创建任务弹窗里的「按链接补 Target / 区域」：按每一行取设计页名与候选，写进工程登记表后回填到链接行。
 * 取值链与写登记表在 app/use-identity-fill.ts，这里只渲染三种结果（已填 / 给候选 / 没结果）。
 * 与 identity-fill-panel.tsx 同一套接法：收「要画的状态 + 几个回调」，不直接吃 hook 的返回值。
 */
export function BoardIdentityFill(props: {
  rows: FillRow[]
  busy: string
  automation: string
  failure: string
  onFill: () => void
  onTake: (row: FillRow, item: IdentityCandidate) => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={props.busy !== ""} onClick={props.onFill}>
          {props.busy === "fill" ? <Loader2 className="animate-spin" /> : <Sparkles />}
          按链接补 Target / 区域
        </Button>
        <span className="text-muted-foreground text-xs">
          按链接取设计页名，再按工程既有区域约定给候选；能定的写进工程登记表并填回这一行。
          当前自动化层级：{AUTOMATION_LABEL[props.automation] ?? props.automation}
        </span>
      </div>
      {props.rows.map((row) => (
        <div key={row.link} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground max-w-56 min-w-0 truncate font-mono" title={row.link}>
            {linkLabel(row.link)}
          </span>
          {row.kind === "filled" && (
            <>
              <Badge variant="secondary">
                {row.target}
                {row.ui ? " · UI " + row.ui : ""}
              </Badge>
              <span className="text-muted-foreground">{row.basis}</span>
            </>
          )}
          {row.kind === "pick" && (
            <>
              {row.items.map((item) => (
                  <span key={item.target + item.ui}>
                    <IdentityCandidateButton
                      item={item}
                      busy={props.busy !== ""}
                      label={item.target + (item.ui ? " · " + item.ui : "")}
                      onTake={() => props.onTake(row, item)}
                    />
                  </span>
                ))}
              {row.reason && <span className="text-amber-600">{row.reason}</span>}
            </>
          )}
          {row.kind === "none" && <span className="text-amber-600">{row.reason}</span>}
        </div>
      ))}
      {props.failure && <p className="text-destructive text-xs">{props.failure}</p>}
    </div>
  )
}
