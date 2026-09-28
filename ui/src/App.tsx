import { useEffect, useState } from "react"
import { Boxes, ListChecks, Search, Settings } from "lucide-react"

import { QueryPage } from "@/app/query-page"
import { PipelinePage } from "@/app/pipeline-page"
import { ReviewPage } from "@/app/review-page"
import { SettingsPage } from "@/app/settings-page"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { useHealth } from "@/lib/use-health"
import { cn } from "@/lib/utils"

const NAV = [
  { key: "query", label: "控件 ID 查询", icon: Search },
  { key: "pipeline", label: "流水线", icon: Boxes },
  { key: "review", label: "待确认", icon: ListChecks },
  { key: "settings", label: "设置", icon: Settings }
] as const

type PageKey = (typeof NAV)[number]["key"]

const PAGE_KEYS = NAV.map((item) => item.key) as readonly string[]

// 页面记在 hash 上：刷新或直接给链接都能落到同一页。
function readHash(): PageKey {
  const raw = window.location.hash.replace(/^#\/?/, "")
  return (PAGE_KEYS.includes(raw) ? raw : "query") as PageKey
}

function StatusBadges() {
  const { health, offline } = useHealth()

  if (offline) {
    return <Badge variant="destructive">服务未就绪</Badge>
  }
  if (!health) {
    return <Badge variant="outline">连接中…</Badge>
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">v{health.version}</Badge>
      <Badge variant={health.plugin.engineExists ? "secondary" : "destructive"}>
        引擎{health.plugin.engineExists ? "就绪" : "缺失"}
      </Badge>
      <Badge variant="outline">插件 {health.plugin.version ? "v" + health.plugin.version : "未知版本"}</Badge>
      {health.frames.length > 0 && <Badge variant="outline">已登记页面帧 {health.frames.length}</Badge>}
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState<PageKey>(readHash)

  useEffect(() => {
    const onHashChange = () => setPage(readHash())
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  function go(key: PageKey) {
    window.location.hash = key
    setPage(key)
  }

  return (
    <div className="bg-background text-foreground flex min-h-svh">
      <aside className="bg-sidebar text-sidebar-foreground flex w-60 shrink-0 flex-col border-r">
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
        <nav className="flex flex-col gap-1 p-2">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = page === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => go(item.key)}
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
          <div className="text-sm font-medium">{NAV.find((item) => item.key === page)?.label}</div>
          <StatusBadges />
        </header>
        <main className="min-w-0 flex-1 overflow-auto p-6">
          {page === "query" && <QueryPage />}
          {page === "pipeline" && <PipelinePage />}
          {page === "review" && <ReviewPage />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}
