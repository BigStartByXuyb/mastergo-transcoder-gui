import { Bot, FileKey, KeyRound, RefreshCw } from "lucide-react"

import { SettingsAgentPanel } from "@/app/settings-agent-panel"
import { SettingsAiPanel } from "@/app/settings-ai-panel"
import { SettingsMastergoPanel } from "@/app/settings-mastergo-panel"
import { SettingsUpdatePanel } from "@/app/settings-update-panel"
import { cn } from "@/lib/utils"

/*
 * 设置是一排二级菜单，不是一页堆叠：找 token 的人不该先滚过 Codex 的版本列表。
 * 子页挂在 `#settings?tab=<key>` 上，切页、刷新、从别处链接进来都落在同一页。
 */

const TABS = [
  { key: "ai", label: "AI token", hint: "厂商 · 地址 · 模型 · key", icon: KeyRound },
  { key: "mastergo", label: "MasterGo token", hint: "设计稿取数凭证", icon: FileKey },
  { key: "agent", label: "AI Agent", hint: "下载与运行环境", icon: Bot },
  { key: "update", label: "更新", hint: "客户端版本与回退", icon: RefreshCw }
] as const

type TabKey = (typeof TABS)[number]["key"]

const TAB_KEYS = TABS.map((tab) => tab.key) as readonly string[]

export function SettingsPage(props: { tab: string; onPickTab: (tab: string) => void }) {
  const active: TabKey = TAB_KEYS.includes(props.tab) ? (props.tab as TabKey) : "ai"

  return (
    // 窄窗口先堆叠再分栏：两栏硬挤会把右栏压成一条竖缝。
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
      <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto md:w-56 md:flex-col md:overflow-x-visible">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const selected = tab.key === active
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => props.onPickTab(tab.key)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors",
                selected
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4" />
                {tab.label}
              </span>
              <span className="text-muted-foreground pl-6 text-xs">{tab.hint}</span>
            </button>
          )
        })}
      </nav>

      {/* 右栏吃掉剩下的宽度：卡片本来就该铺开，收窄只会让长路径与表格挤成一团。 */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {active === "ai" && <SettingsAiPanel />}
        {active === "mastergo" && <SettingsMastergoPanel />}
        {active === "agent" && <SettingsAgentPanel />}
        {active === "update" && <SettingsUpdatePanel />}
      </div>
    </div>
  )
}
