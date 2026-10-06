import { useEffect, useRef, useState } from "react"
import { Check, FolderSearch, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { PixelLoader } from "@/app/pixel-loader"
import { PluginEnvPanel } from "@/app/plugin-env-panel"
import { PluginInstallPanel } from "@/app/plugin-install-panel"
import { api, type PluginSources } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { groupPluginSources, type PluginSourceRow } from "@/lib/plugin-sources"

/*
 * 插件来源：转码引擎来自 mastergo-wpf-transcoder 插件，客户端不自带。
 *
 * 两件事分开放，各自说清自己的作用：
 *   按顺序自动 —— 让客户端自己按内置顺序找（清掉「设置的」那一份）
 *   指定目录  —— 插件装在别处时，直接指一个位置，立刻生效
 * 下面按两组表格列出所有位置（本机指定的 / 自动查找的），表头是 版本 / 状态 / 路径 / 切换。
 * 一个客户机上可能同时装着好几份（Codex 缓存、Claude 缓存、自己指定的目录），选错了跑出来的东西不一样。
 */
export function PluginCard() {
  const [view, setView] = useState<PluginSources | null>(null)
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState("")

  // 卸载之后迟到的响应不再落状态（首次读取与装完刷新走的是同一个 load）。
  const alive = useRef(true)

  /* 读一遍来源清单：首次进来读一次；装完插件、换过一份之后也要重读（表里那一行的状态跟着变）。 */
  async function load() {
    try {
      const payload = await api.pluginSources()
      if (!alive.current) return
      setView(payload)
      setFailure("")
    } catch (error) {
      if (!alive.current) return
      setFailure(describeFailure(error))
    }
  }

  useEffect(() => {
    // StrictMode 下会「挂载 → 卸下 → 再挂载」：这里要重新放行，否则首次读取永远被拦掉。
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
  }, [])


  /* 空串＝回到「按顺序自动」；有任务在跑时后端会拒绝并说明原因。 */
  async function choose(path: string, key: string) {
    setBusy(key)
    setFailure("")
    try {
      const payload = await api.pluginChoose(path)
      setView(payload)
      toast.success(path ? "已换用这一份插件" : "已改回按顺序自动找")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  async function pickFolder() {
    setBusy("pick")
    setFailure("")
    try {
      const picked = await api.pickFolder()
      if (picked.path) await choose(picked.path, "pick")
      else if (picked.reason) toast.info(picked.reason)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  const automatic = view ? view.chosen === "" : false

  return (
    <Card>
      <CardHeader>
        <CardTitle>插件</CardTitle>
        <CardDescription>转码引擎来自插件；下面这些位置都查过，用的是标「正在用」的那一份。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!view && !failure && <PixelLoader text="请稍等，正在查找插件" cell={3} className="py-4" />}

        {failure && (
          <Alert variant="destructive">
            <AlertTitle>出错了</AlertTitle>
            <AlertDescription>
              <ClampText text={failure} />
            </AlertDescription>
          </Alert>
        )}

        {view && view.plugin.failure && (
          <Alert variant="destructive">
            <AlertTitle>没找到插件</AlertTitle>
            <AlertDescription>
              <ClampText lines={5} text={view.plugin.failure} />
            </AlertDescription>
          </Alert>
        )}

        {view && (
          <>
            {/* 客户端自带的那一份从哪儿来、装到哪儿：装在别处的那几份在下面两张表里。 */}
            <PluginInstallPanel
              activeRoot={view.plugin.root}
              onInstalled={() => {
                void load()
              }}
            />

            {/* 两个动作分开：一个让客户端自己按顺序找，一个直接指定位置。 */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">按顺序自动</span>
                  {/* 这里不挂「正在用」徽标：那是表格里某一条来源的状态，两处同名会让人以为是同一种事。 */}
                  {automatic && <span className="text-muted-foreground text-xs">现在是自动</span>}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(busy) || automatic}
                    onClick={() => void choose("", "auto")}
                  >
                    {busy === "auto" && <Loader2 className="size-4 animate-spin" />}
                    交给客户端找
                  </Button>
                </div>
                <span className="text-muted-foreground text-xs">
                  清掉「我指定的那一份」，让客户端自己按内置顺序找；下面列出的位置，就是它从上到下依次会看的地方。
                </span>
              </div>

              <div className="flex flex-col gap-1 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">指定一个目录</span>
                  <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void pickFolder()}>
                    {busy === "pick" ? <Loader2 className="size-4 animate-spin" /> : <FolderSearch className="size-4" />}
                    选目录…
                  </Button>
                </div>
                <span className="text-muted-foreground text-xs">
                  插件装在别处时用这个：指到插件根、或指到装着它的目录都认，选完立刻生效。
                </span>
              </div>
            </div>

            {groupPluginSources(view.sources).map((group) => (
              <div key={group.key} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{group.title}</span>
                  <span className="text-muted-foreground text-xs">{group.hint}</span>
                </div>
                <PluginSourceTable sources={group.sources} busy={busy} onChoose={choose} />
              </div>
            ))}
          </>
        )}

        {/* 环境变量：写给系统的那一份，别的工具与命令行也认；与上面的「用这份」不是一件事。
            来源清单没读出来也照样给这一块 —— 两者互不依赖。 */}
        <PluginEnvPanel />
      </CardContent>
    </Card>
  )
}

/*
 * 一组来源一张表：版本 / 状态 / 路径 / 切换。
 * 路径那一列是等宽、可折行的标识符（窄屏也不丢内容，完整路径挂 title）。
 */
function PluginSourceTable(props: {
  sources: PluginSourceRow[]
  busy: string
  onChoose: (path: string, key: string) => Promise<void>
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[22%]">位置</TableHead>
            <TableHead className="w-[12%]">版本</TableHead>
            <TableHead className="w-[12%]">状态</TableHead>
            <TableHead>路径</TableHead>
            <TableHead className="w-[14%] text-right">切换</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.sources.map((source) => (
            <TableRow key={source.id}>
              <TableCell className="align-top text-sm whitespace-normal">{source.label}</TableCell>
              <TableCell className="align-top text-xs whitespace-normal">
                {source.exists && source.version ? (
                  <span className="font-mono">v{source.version}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                {source.active ? (
                  <Badge variant="secondary">
                    <Check className="size-3" />
                    正在用
                  </Badge>
                ) : source.exists ? (
                  <Badge variant="outline">可用</Badge>
                ) : (
                  <Badge variant="outline">没有</Badge>
                )}
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                <IdentifierText className="text-muted-foreground text-xs" text={source.path} />
                {source.alsoFrom.length > 0 && (
                  <span className="text-muted-foreground block text-xs">
                    同时来自：{source.alsoFrom.join("、")}
                  </span>
                )}
                {source.found.length > 1 && (
                  <span className="text-muted-foreground block text-xs">
                    这一处有 {source.found.length} 份，用最高版本
                  </span>
                )}
              </TableCell>
              <TableCell className="align-top text-right whitespace-normal">
                {source.exists && !source.active && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={Boolean(props.busy)}
                    onClick={() => void props.onChoose(source.pluginRoot, source.id)}
                  >
                    {props.busy === source.id && <Loader2 className="size-4 animate-spin" />}
                    用这份
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
