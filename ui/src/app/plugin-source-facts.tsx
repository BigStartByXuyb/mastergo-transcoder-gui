import { Check } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { IdentifierText } from "@/app/identifier-text"
import type { PluginUpdateStatus } from "@/lib/api"
import { describePluginInstall } from "@/lib/plugin-install"
import type { PluginSourceRow } from "@/lib/plugin-sources"

/*
 * 一个来源的几条事实：状态徽章 / 版本 / 这一处有几份 / 同时来自 / 解析到哪一份。
 * 表里那一行与点开后的面板都渲染这一份 —— 两处说的是同一份数据，就不该各写一遍
 * （改口径只改这里，表与面板不会一处说「可用」、另一处说别的）。
 */

/**
 * 一个来源此刻的处境怎么说。表、面板的徽章与顺序条上那一档读同一处 ——
 * 同一格事实（有 / 没有 / 正在用）不会一处写「有」、另一处写「可用」。
 */
export function sourceStatusText(active: boolean, exists: boolean): string {
  if (active) return "正在用"
  return exists ? "可用" : "没有"
}

export function SourceStatusBadge(props: { active: boolean; exists: boolean }) {
  if (props.active) {
    return (
      <Badge variant="secondary">
        <Check className="size-3" />
        {sourceStatusText(true, props.exists)}
      </Badge>
    )
  }
  return <Badge variant="outline">{sourceStatusText(false, props.exists)}</Badge>
}

export function SourceVersion(props: { row: PluginSourceRow }) {
  if (!props.row.exists || !props.row.version) return <span className="text-muted-foreground">—</span>
  return <span className="font-mono">v{props.row.version}</span>
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

/**
 * 「客户端自带那一份」的更新状态徽章（文字与色调都按 describePluginInstall 一处给）：
 * 来源表里自带那一行与点开后的管理面板读的是同一个组件，不会一处写「有新版」、另一处忘了带上色调。
 */
export function PluginInstallBadge(props: { status: PluginUpdateStatus | null }) {
  const summary = describePluginInstall(props.status)
  return <Badge variant={summary.tone}>{summary.label}</Badge>
}
