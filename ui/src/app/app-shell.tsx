import type { ReactNode } from "react"
import { Boxes, LayoutGrid, ListChecks, MessagesSquare, Plus, Search, Settings, Table2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { AreaEntry } from "@/lib/areas"
import { areaAttention, areaLabel, groupByProject } from "@/lib/areas"
import { cn } from "@/lib/utils"

/*
 * 外壳：左边一份共用侧边栏（工程 → 区域），右边一屏内容。
 *
 * 侧边栏只有一份，所有页面共用 —— 各页各做一套会让「选中的工程/区域」出现两份状态，
 * 切页就丢、清空要写两遍。区域是导航单元，工具类页面挂在下面固定区。
 */

export const TOOLS = [
  { key: "board", label: "看板", icon: LayoutGrid },
  { key: "chat", label: "对话", icon: MessagesSquare },
  { key: "review", label: "待确认", icon: ListChecks },
  { key: "query", label: "控件 ID 查询", icon: Search },
  { key: "mapping", label: "映射表", icon: Table2 },
  { key: "settings", label: "设置", icon: Settings }
] as const

export type ToolKey = (typeof TOOLS)[number]["key"]

type Props = {
  areas: AreaEntry[]
  activeAreaKey: string
  /** 非工具页（区域详情、任务详情）不点亮任何工具项。 */
  activeTool: ToolKey | null
  title: string
  status: ReactNode
  onGoTool: (key: ToolKey) => void
  onGoArea: (area: AreaEntry) => void
  onForgetProject: (projectRoot: string) => void
  onNewTask: () => void
  children: ReactNode
}

export function AppShell(props: Props) {
  const groups = groupByProject(props.areas)

  return (
    <div className="bg-background text-foreground flex h-svh overflow-hidden">
      {/* 侧边栏固定宽（w-72）、固定高（h-svh）：中间内容再长也只在右边滚，不把它撑开。 */}
      <aside className="bg-sidebar text-sidebar-foreground flex w-72 shrink-0 flex-col overflow-hidden border-r">
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
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
          <div className="flex items-center justify-between gap-2 px-2 pt-1">
            <span className="text-muted-foreground text-xs font-medium">区域</span>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={props.onNewTask}>
              <Plus className="size-3.5" />
              新建任务
            </Button>
          </div>

          {groups.length === 0 && (
            <p className="text-muted-foreground px-2 text-xs leading-relaxed">
              还没有用过的工程。新建一次任务、或填一次工程目录，这里就会出现「工程 → 区域」。
            </p>
          )}

          {groups.map((group) => (
            <div key={group.projectRoot} className="flex flex-col gap-1">
              <div className="flex items-center gap-1 px-2">
                <span
                  className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs"
                  title={group.projectRoot}
                >
                  {group.projectRoot}
                </span>
                {/* 只有这个工程已经没有任务时才给「移除」：删除只清本地记忆，任务还在时移除会被下一轮拉回来。 */}
                {!group.hasTasks && (
                  <button
                    type="button"
                    title="从侧边栏移除（不动工程与登记表）"
                    className="text-muted-foreground hover:text-sidebar-accent-foreground px-1 text-xs"
                    onClick={() => props.onForgetProject(group.projectRoot)}
                  >
                    ✕
                  </button>
                )}
              </div>
              {group.areas.map((area) => {
                const active = area.key === props.activeAreaKey
                const attention = areaAttention(area)
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
                    {/* 三个数各有各的口径：跑着的、要你动手的、纯历史总数。 */}
                    {area.running > 0 && (
                      <Badge variant="default" title={"该区域有 " + area.running + " 条任务正在跑"}>
                        {area.running} 跑着
                      </Badge>
                    )}
                    {area.running === 0 && attention > 0 && (
                      <Badge
                        variant="secondary"
                        title={"该区域有 " + attention + " 条任务在等你处理（共 " + area.tasks.length + " 条）"}
                      >
                        {attention} 待处理
                      </Badge>
                    )}
                    {area.running === 0 && attention === 0 && area.tasks.length > 0 && (
                      <span
                        className="text-muted-foreground text-xs tabular-nums"
                        title={"该区域共 " + area.tasks.length + " 条任务，都已结束"}
                      >
                        {area.tasks.length}
                      </span>
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

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
          <div className="min-w-0 truncate text-sm font-medium">{props.title}</div>
          {props.status}
        </header>
        {/* 内容宽度固定在一处：所有页面一样宽，窗口再宽也不跟着拉长。 */}
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto w-full max-w-5xl">{props.children}</div>
        </main>
      </div>
    </div>
  )
}
