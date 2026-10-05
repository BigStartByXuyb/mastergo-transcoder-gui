import { Bot, FileKey, KeyRound, RefreshCw, Terminal } from "lucide-react"

import { SettingsAgentPanel } from "@/app/settings-agent-panel"
import { SettingsAiPanel } from "@/app/settings-ai-panel"
import { SettingsMastergoPanel } from "@/app/settings-mastergo-panel"
import { SettingsRuntimePanel } from "@/app/settings-runtime-panel"
import { SettingsUpdatePanel } from "@/app/settings-update-panel"
import { TabButton } from "@/app/tab-button"

/*
 * 设置是一排二级菜单，不是一页堆叠：找 token 的人不该先滚过 Codex 的版本列表。
 * 子页挂在 `#settings?tab=<key>` 上，切页、刷新、从别处链接进来都落在同一页。
 *
 * 插件与更新是同一件事的两段（谁在更新、更新谁），合并进「更新」一页：`&part=client|plugin`。
 * 界面上曾经有个独立的「插件」页，老链接（tab=plugin）落到同一页的插件那一段。
 */

const TABS = [
  { key: "ai", label: "AI token", hint: "厂商 · 地址 · 模型 · key", icon: KeyRound },
  { key: "mastergo", label: "MasterGo token", hint: "设计稿取数凭证", icon: FileKey },
  { key: "agent", label: "AI Agent", hint: "引擎 · 写盘开关", icon: Bot },
  { key: "runtime", label: "运行环境", hint: "组件 · 版本 · 补齐", icon: Terminal },
  { key: "update", label: "更新", hint: "客户端 · 插件（流水线）", icon: RefreshCw }
] as const

type TabKey = (typeof TABS)[number]["key"]

const TAB_KEYS = TABS.map((tab) => tab.key) as readonly string[]

export function SettingsPage(props: {
  tab: string
  /** 「更新」页里的两段：client / plugin（空串＝客户端那一段）。 */
  part: string
  onPickTab: (tab: string) => void
  onPickPart: (part: string) => void
}) {
  const legacyPlugin = props.tab === "plugin"
  const wanted = legacyPlugin ? "update" : props.tab
  const active: TabKey = TAB_KEYS.includes(wanted) ? (wanted as TabKey) : "ai"

  return (
    /*
     * 两栏都撑满这一屏：菜单栏高度固定（不随子页长短伸缩），右栏自己滚，
     * 页面本身不往下拖。窄窗口先堆叠再分栏，免得右栏被压成一条竖缝。
     */
    <div className="flex h-full min-h-0 flex-col gap-4 md:flex-row md:gap-6">
      <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b pb-3 md:h-full md:w-56 md:flex-col md:overflow-x-visible md:border-r md:border-b-0 md:pr-3 md:pb-0">
        {TABS.map((tab) => {
          return (
            <TabButton
              key={tab.key}
              selected={tab.key === active}
              label={tab.label}
              hint={tab.hint}
              icon={tab.icon}
              onClick={() => props.onPickTab(tab.key)}
            />
          )
        })}
      </nav>

      {/* 右栏吃掉剩下的宽度与高度：卡片铺开，内容多的子页自己滚。 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
        {active === "ai" && <SettingsAiPanel />}
        {active === "mastergo" && <SettingsMastergoPanel />}
        {active === "agent" && <SettingsAgentPanel />}
        {active === "runtime" && <SettingsRuntimePanel />}
        {active === "update" && (
          <SettingsUpdatePanel
            /* 客户端 / 插件（流水线）两段：谁在更新、更新谁。 */
            part={legacyPlugin ? "plugin" : props.part}
            onPickPart={props.onPickPart}
          />
        )}
      </div>
    </div>
  )
}
