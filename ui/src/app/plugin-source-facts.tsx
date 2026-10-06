import { Check } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { IdentifierText } from "@/app/identifier-text"
import type { PluginSourceRow } from "@/lib/plugin-sources"

/*
 * 一个来源的几条事实：状态徽章 / 版本 / 这一处有几份 / 同时来自。
 * 表里那一行与点开后的面板都渲染这一份 —— 两处说的是同一份数据，就不该各写一遍
 * （改口径只改这里，表与面板不会一处说「可用」、另一处说别的）。
 */

export function SourceStatusBadge(props: { row: PluginSourceRow }) {
  if (props.row.active) {
    return (
      <Badge variant="secondary">
        <Check className="size-3" />
        正在用
      </Badge>
    )
  }
  return <Badge variant="outline">{props.row.exists ? "可用" : "没有"}</Badge>
}

export function SourceVersion(props: { row: PluginSourceRow; className?: string }) {
  if (!props.row.exists || !props.row.version) return <span className="text-muted-foreground">—</span>
  return <span className={props.className ? "font-mono " + props.className : "font-mono"}>v{props.row.version}</span>
}

export function SourceCopyCount(props: { row: PluginSourceRow }) {
  if (props.row.found.length <= 1) return null
  return (
    <span className="text-muted-foreground block text-xs">
      这一处有 {props.row.found.length} 份，用最高版本
    </span>
  )
}

export function SourceAlsoFrom(props: { row: PluginSourceRow }) {
  if (props.row.alsoFrom.length === 0) return null
  return <span className="text-muted-foreground block text-xs">同时来自：{props.row.alsoFrom.join("、")}</span>
}

/** 面板里那一行「解析到：某一份」——表里放不下，只在面板里出现。 */
export function SourceResolvedRoot(props: { row: PluginSourceRow }) {
  if (props.row.found.length === 0) return null
  return <IdentifierText className="text-muted-foreground text-xs" text={"解析到：" + props.row.pluginRoot} />
}
