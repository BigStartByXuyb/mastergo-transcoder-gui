import { IdentifierText } from "@/app/identifier-text"
import { PluginCard } from "@/app/plugin-card"
import { PixelLoader } from "@/app/pixel-loader"
import { UpdateCard } from "@/app/update-card"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useHealth } from "@/lib/use-health"

/*
 * 更新这一页：上面是「现在用的是什么」（运行环境），下面分两段 —— 客户端与插件（流水线）。
 * 两段是两条独立的版本线：客户端是界面/看板/对话本身，插件是转码步骤与映射表。
 */

const PARTS = [
  { key: "client", label: "客户端", hint: "界面 · 看板 · 对话" },
  { key: "plugin", label: "插件（流水线）", hint: "转码步骤与映射表" }
] as const

export function SettingsUpdatePanel(props: { part: string; onPickPart: (part: string) => void }) {
  const { health, offline } = useHealth(10000)
  const part = props.part === "plugin" ? "plugin" : "client"

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>运行环境</CardTitle>
          <CardDescription>当前使用的插件与引擎。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {offline && <p className="text-destructive text-sm">连不上本地服务。</p>}
          {!offline && !health && <PixelLoader text="请稍等，正在读取运行环境" cell={3} className="py-4" />}
          {health && (
            <dl className="grid gap-4">
              <div>
                <dt className="text-muted-foreground text-xs">客户端版本</dt>
                <dd className="text-sm">
                  <Badge variant="secondary">v{health.version}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">插件</dt>
                <dd className="text-sm break-all">
                  {health.plugin.root}
                  {health.plugin.version ? "（v" + health.plugin.version + "）" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">控件查询引擎</dt>
                <dd className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={health.plugin.engineExists ? "secondary" : "destructive"}>
                    {health.plugin.engineExists ? "已找到" : "缺失"}
                  </Badge>
                  <IdentifierText text={health.plugin.engine} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">流水线入口</dt>
                <dd className="text-sm">
                  <Badge variant={health.plugin.runAllExists ? "secondary" : "destructive"}>
                    {health.plugin.runAllExists ? "已找到" : "缺失"}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">已登记页面帧</dt>
                <dd className="text-sm">{health.frames.length}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <div role="tablist" aria-label="更新对象" className="flex gap-1 rounded-lg border p-1">
        {PARTS.map((item) => {
          const selected = item.key === part
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => props.onPickPart(item.key)}
              className={cn(
                "flex flex-1 flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors",
                selected
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
              )}
            >
              <span className="text-sm font-medium">{item.label}</span>
              <span className="text-muted-foreground text-xs">{item.hint}</span>
            </button>
          )
        })}
      </div>

      {/* 换段时新的一块淡入并轻轻下落一点：150 毫秒；系统要求减少动效时不做动画。 */}
      <div key={part} className="animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none">
        {part === "client" ? <UpdateCard /> : <PluginCard />}
      </div>
    </div>
  )
}
