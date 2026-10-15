import { PluginCard } from "@/app/plugin-card"
import { TabButton } from "@/app/tab-button"
import { UpdateCard } from "@/app/update-card"

/*
 * 更新这一页：两段 —— 客户端与插件（流水线）。
 * 两段是两条独立的版本线：客户端是界面/看板/对话本身，插件是转码步骤与映射表；
 * 「此刻生效的是哪一份」（含两份运行时）在「运行环境」那一页。
 */

const PARTS = [
  { key: "client", label: "客户端", hint: "界面 · 看板 · 对话" },
  { key: "plugin", label: "插件（流水线）", hint: "转码步骤与映射表" }
] as const

export function SettingsUpdatePanel(props: { part: string; onPickPart: (part: string) => void }) {
  const part = props.part === "plugin" ? "plugin" : "client"

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="更新对象" className="flex gap-1 rounded-lg border p-1">
        {PARTS.map((item) => (
          <TabButton
            key={item.key}
            selected={item.key === part}
            label={item.label}
            hint={item.hint}
            className="flex-1"
            onClick={() => props.onPickPart(item.key)}
          />
        ))}
      </nav>

      {/* 换段时新的一块淡入并轻轻下落一点：150 毫秒；系统要求减少动效时不做动画。 */}
      <div key={part} className="animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none">
        {part === "client" ? <UpdateCard /> : <PluginCard />}
      </div>
    </div>
  )
}
