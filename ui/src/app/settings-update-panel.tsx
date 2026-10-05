import { IdentifierText } from "@/app/identifier-text"
import { PixelLoader } from "@/app/pixel-loader"
import { SourceCard } from "@/app/source-card"
import { UpdateCard } from "@/app/update-card"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useHealth } from "@/lib/use-health"

/*
 * 更新这一页：运行环境 → 发布源（更新从哪儿来）→ 客户端自己的版本（检查 / 下载 / 逐版切换）。
 * 三块竖着排，一屏放得下。
 */
export function SettingsUpdatePanel() {
  const { health, offline } = useHealth(10000)

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

      <SourceCard />

      <UpdateCard />
    </div>
  )
}
