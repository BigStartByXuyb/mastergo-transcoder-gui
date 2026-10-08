import { Check } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { IdentifierText } from "@/app/identifier-text"
import type { PluginSource, PluginUpdateStatus } from "@/lib/api"
import { describePluginInstall } from "@/lib/plugin-install"

/*
 * 一个来源的几条事实：状态徽章 / 版本 / 这一处有几份 / 解析到哪一份。
 * 卡片那一行与点开后的面板都渲染这一份 —— 两处说的是同一份数据，就不该各写一遍
 * （改口径只改这里，卡与面板不会一处说「正在用」、另一处说别的）。
 */

/* 一个来源此刻的处境怎么说。卡片那一行与面板的徽章读同一处 —— 同一格事实不会一处写「有」、另一处写别的。 */
function sourceStatusText(active: boolean, exists: boolean): string {
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

export function SourceVersion(props: { row: PluginSource }) {
  if (!props.row.exists || !props.row.version) return <span className="text-muted-foreground">—</span>
  return <span className="font-mono">v{props.row.version}</span>
}

export function SourceCopyCount(props: { row: PluginSource }) {
  if (props.row.found.length <= 1) return null
  return (
    <span className="text-muted-foreground block text-xs">
      这一处有 {props.row.found.length} 份，用最高版本
    </span>
  )
}

/** 面板里那一行「解析到：某一份」——卡片那一行放不下，只在面板里出现。 */
export function SourceResolvedRoot(props: { row: PluginSource }) {
  if (props.row.found.length === 0) return null
  return <IdentifierText className="text-muted-foreground text-xs" text={"解析到：" + props.row.pluginRoot} />
}

/**
 * 「客户端自带那一份」的更新状态徽章（文字与色调都按 describePluginInstall 一处给）：
 * 卡片那一行与点开后的管理面板读的是同一个组件，不会一处写「有新版」、另一处忘了带上色调。
 */
export function PluginInstallBadge(props: { status: PluginUpdateStatus | null }) {
  const summary = describePluginInstall(props.status)
  return <Badge variant={summary.tone}>{summary.label}</Badge>
}
