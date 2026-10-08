import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { IdentifierText } from "@/app/identifier-text"
import type { UpdateSource } from "@/lib/api"
import { sourceKindLabel } from "@/lib/source-kind"

/*
 * 「更新来源」那一行：现在从哪儿取（类型 / 地址）、有没有带 token、点一下改。
 *
 * 程序更新与插件（流水线）各有一项设置（`source` 与 `pluginSource`，各有各的默认与凭据），
 * 但这一行的形状与拼法一样（后端 lib/source.js 一处拼地址），所以只有这一处实现 ——
 * 改口径只改这里，两半不会一处说「已带 token」、另一处忘了说。
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
      <SourceBadges source={props.source} hasToken={props.hasToken} />
      <IdentifierText text={props.source.base} className="min-w-0 flex-1 text-xs" />
      <Button variant="outline" size="sm" disabled={props.disabled} onClick={props.onEdit}>
        修改发布源
      </Button>
    </div>
  )
}

/**
 * 发布源的两颗徽标（类型 + 有没有带 token）：「更新来源」那一行与改发布源的弹窗都渲染这一份，
 * 口径改动只改这里，两处不会一处说「已带 token」、另一处忘了说。
 * 类型的写法与弹窗里的下拉同一处（sourceKindLabel）—— 同一字段不会一处写 github、另一处写「GitHub 仓库」。
 */
export function SourceBadges(props: { source: UpdateSource; hasToken: boolean }) {
  return (
    <>
      <Badge variant="secondary">{sourceKindLabel(props.source.kind)}</Badge>
      {props.hasToken && <Badge variant="outline">已带 token</Badge>}
    </>
  )
}
