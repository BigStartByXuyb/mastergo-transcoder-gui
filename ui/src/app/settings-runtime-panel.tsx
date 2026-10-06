import { IdentifierText } from "@/app/identifier-text"
import { PixelLoader } from "@/app/pixel-loader"
import { RuntimePanel } from "@/app/runtime-panel"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useHealth } from "@/lib/use-health"

/*
 * 「运行环境」这一页：现在用的是什么，以及跑流水线要的两份运行时（补齐与开关都在这儿）。
 *
 * 单独一页而不是塞在「更新」里：这一页是「此刻生效的是哪一份」（只读事实 + 运行组件的下载/开关），
 * 「更新」那一页是「版本线的更新与回退」（客户端 / 插件）。两件事的轮询节奏与失败说法都不一样，
 * 挤在一张卡里会出现「一张卡两种脾气」。
 */
export function SettingsRuntimePanel() {
  const { health, offline } = useHealth(10000)

  return (
    <Card>
      <CardHeader>
        <CardTitle>运行环境</CardTitle>
        <CardDescription>转码需要的组件，以及此刻生效的是哪一份。</CardDescription>
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

        {/* Node.js / PowerShell 7 / Claude Code 三行：与上面是同一个问题「现在用的是什么」。 */}
        <div className="border-t pt-4">
          <p className="text-muted-foreground pb-3 text-xs">
            「客户端自带」指客户端自己管理的那两份：版本由我们钉死，装好之后放在<strong>安装目录的
            runtime\ 下</strong>，跟客户机上装没装无关。安装包里<strong>不带</strong>它们
            （Node 约 100 MB、PowerShell 7 约 245 MB），第一次点那一行的「下载」把它取回来；
            取不到外网就在那一行的「来源」里改从内网地址取。
          </p>
          <RuntimePanel />
        </div>
      </CardContent>
    </Card>
  )
}
