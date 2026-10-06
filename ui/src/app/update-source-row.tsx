import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { IdentifierText } from "@/app/identifier-text"
import type { UpdateSource } from "@/lib/api"

/*
 * 「更新来源」那一行：现在从哪儿取（类型 / 地址）、有没有带 token、点一下改。
 *
 * 程序更新与插件（流水线）两半显示的是同一处设置、同一份拼法（后端 lib/source.js），
 * 所以这一行只有这一处实现：改口径只改这里，两半不会一处说「已带 token」、另一处忘了说。
 */

export function UpdateSourceRow(props: {
  source: UpdateSource
  hasToken: boolean
  /** 有任务在跑、或正在下载时不给改（改完要立刻生效）。 */
  disabled: boolean
  onEdit: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
      <span className="text-muted-foreground text-xs">更新来源</span>
      <Badge variant="secondary">{props.source.kind}</Badge>
      {props.hasToken && <Badge variant="outline">已带 token</Badge>}
      <IdentifierText text={props.source.base} className="min-w-0 flex-1 text-xs" />
      <Button variant="outline" size="sm" disabled={props.disabled} onClick={props.onEdit}>
        修改发布源
      </Button>
    </div>
  )
}
