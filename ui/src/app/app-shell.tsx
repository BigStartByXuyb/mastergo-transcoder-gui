import type { ReactNode } from "react"
import { Boxes, LayoutGrid, ListChecks, Plus, Search, Settings, Table2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { AreaEntry } from "@/lib/areas"
import { areaLabel } from "@/lib/areas"
import { cn } from "@/lib/utils"

/*
 * 外壳：左边一份共用侧边栏（工程 → 区域），右边一屏内容。
 *
 * 侧边栏只有一份，所有页面共用 —— 各页各做一套会让「选中的工程/区域」出现两份状态，
 * 切页就丢、清空要写两遍。区域是导航单元，工具类页面挂在下面固定区。
 */

export const TOOLS = [
  { key: "board", label: "看板", icon: LayoutGrid },
  { key: "review", label: "待确认", icon: ListChecks },
  { key: "query", label: "控件 ID 查询", icon: Search },
  { key: "mapping", label: "映射表", icon: Table2 },
  { key: "settings", label: "设置", icon: Settings }
] as const

export type ToolKey = (typeof TOOLS)[number]["key"]

type Props = {
  areas: AreaEntry[]
  activeAreaKey: string
  activeTool: ToolKey
  title: string
  status: ReactNode
  onGoTool: (key: ToolKey) => void
  onGoArea: (area: AreaEntry) => void
  onNewTask: () => void
  children: ReactNode
}

export function AppShell(props: Props) {
  const projects = [...new Set(props.areas.map((area) => area.projectRoot))]

  return (
    <div className="bg-background text-foreground flex min-h-svh">
      <aside className="bg-sidebar text-sidebar-foreground flex w-72 shrink-0 flex-col border-r">
        <div className="flex items-center gap-3 px-4 py-5">
          <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg text-sm font-semibold">
            MG
          </div>
          <div className="leading-tight">
            <div className="text-sm font-medium">MasterGo 转码</div>
            <div className="text-muted-foreground text-xs">本地客户端</div>
          </div>
        </div>
        <Separator />

        {/* 区域：一个工程一段，段里一个区域一行。点了就进这个区域的详情。 */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-2">
          <div className="flex items-center justify-between gap-2 px-2 pt-1">
            <span className="text-muted-foreground text-xs font-medium">区域</span>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={props.onNewTask}>
              <Plus className="size-3.5" />
              新建任务
            </Button>
          </div>

          {projects.length === 0 && (
            <p className="text-muted-foreground px-2 text-xs leading-relaxed">
              还没有用过的工程。新建一次任务、或填一次工程目录，这里就会出现「工程 → 区域」。
            </p>
          )}

          {projects.map((projectRoot) => (
            <div key={projectRoot} className="flex flex-col gap-1">
              <div className="text-muted-foreground truncate px-2 font-mono text-xs" title={projectRoot}>
                {projectRoot}
              </div>
              {props.areas
                .filter((area) => area.projectRoot === projectRoot)
                .map((area) => {
                  const active = area.key === props.activeAreaKey
                  return (
                    <button
                      key={area.key}
                      type="button"
                      onClick={() => props.onGoArea(area)}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                      )}
                    >
                      <Boxes className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{areaLabel(area.ui)}</span>
                      {area.running > 0 && <Badge variant="default">{area.running} 跑着</Badge>}
                      {area.running === 0 && area.tasks.length > 0 && (
                        <span className="text-muted-foreground text-xs tabular-nums">{area.tasks.length}</span>
                      )}
                    </button>
                  )
                })}
            </div>
          ))}
        </div>

        <Separator />
        <nav className="flex flex-col gap-1 p-2">
          {TOOLS.map((item) => {
            const Icon = item.icon
            const active = props.activeTool === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => props.onGoTool(item.key)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            )
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
          <div className="min-w-0 truncate text-sm font-medium">{props.title}</div>
          {props.status}
        </header>
        <main className="min-w-0 flex-1 overflow-auto p-6">{props.children}</main>
      </div>
    </div>
  )
}
