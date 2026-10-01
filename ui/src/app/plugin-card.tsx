import { useEffect, useState } from "react"
import { Check, FolderSearch, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { PixelLoader } from "@/app/pixel-loader"
import { api, type PluginEnvScopes, type PluginSources } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 插件来源：转码引擎来自 mastergo-wpf-transcoder 插件，客户端不自带。
 * 这一页把「都查过哪些路径、各自有没有、正在用哪一份」摆出来，并且能换一份 —— 换完立刻生效。
 * 一个客户机上可能同时装着好几份（Codex 缓存、Claude 缓存、自己指定的目录），选错了跑出来的东西不一样。
 */
export function PluginCard() {
  const [view, setView] = useState<PluginSources | null>(null)
  const [envName, setEnvName] = useState("MASTERGO_PLUGIN_ROOT")
  const [scopes, setScopes] = useState<PluginEnvScopes | null>(null)
  const [draft, setDraft] = useState("")
  const [envBusy, setEnvBusy] = useState("")
  // "" / "saved" / "cleared"：存完要说清这次是写进去了还是清掉了。
  const [saved, setSaved] = useState("")
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState("")

  useEffect(() => {
    let stopped = false
    async function loadSources() {
      try {
        const payload = await api.pluginSources()
        if (!stopped) setView(payload)
      } catch (error) {
        if (!stopped) setFailure(describeFailure(error))
      }
    }
    // 环境变量单独取：读它要起一次 pwsh，不该拖慢上面那份来源清单。
    async function loadEnv() {
      try {
        const payload = await api.pluginEnv()
        if (stopped) return
        setEnvName(payload.name)
        setScopes(payload.envScopes)
        setDraft(payload.envScopes.user || "")
      } catch (error) {
        if (!stopped) setFailure(describeFailure(error))
      }
    }
    void loadSources()
    void loadEnv()
    return () => {
      stopped = true
    }
  }, [])

  /* 空串＝清掉。写完由新起的进程读到，所以这里要提醒「重启才生效」。 */
  async function saveEnv(value: string) {
    setEnvBusy(value ? "save" : "clear")
    setFailure("")
    try {
      const payload = await api.pluginEnvSave(value)
      setScopes(payload.envScopes)
      setDraft(payload.envScopes.user || "")
      setSaved(value ? "saved" : "cleared")
      if (!value) toast.success("已清掉环境变量 " + payload.name)
      else if (payload.resolves) toast.success("已写入环境变量；重启客户端后生效")
      else toast.warning("已写入，但这个位置现在没有插件")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setEnvBusy("")
    }
  }


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
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">自动（按顺序）</span>
                {automatic && (
                  <Badge variant="secondary">
                    <Check className="size-3" />
                    正在用
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(busy) || automatic}
                  onClick={() => void choose("", "auto")}
                >
                  {busy === "auto" && <Loader2 className="size-4 animate-spin" />}
                  用自动
                </Button>
                <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void pickFolder()}>
                  {busy === "pick" ? <Loader2 className="size-4 animate-spin" /> : <FolderSearch className="size-4" />}
                  选一个目录…
                </Button>
              </div>
              <span className="text-muted-foreground text-xs">
                启动参数 → 这里选的 → 环境变量 → Codex 缓存与市场 → Claude 缓存与市场 → 客户端自带。显式指定的那一份不在了就往下走。
              </span>
            </div>

            {view.sources.map((source) => (
              <div key={source.id} className="flex flex-col gap-1 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{source.label}</span>
                  {source.active ? (
                    <Badge variant="secondary">
                      <Check className="size-3" />
                      正在用
                    </Badge>
                  ) : source.exists ? (
                    <Badge variant="outline">v{source.version || "未知版本"}</Badge>
                  ) : (
                    <Badge variant="outline">没有</Badge>
                  )}
                  {source.found.length > 1 && (
                    <span className="text-muted-foreground text-xs">共 {source.found.length} 份，用最高版本</span>
                  )}
                  {source.exists && !source.active && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(busy)}
                      onClick={() => void choose(source.pluginRoot, source.id)}
                    >
                      {busy === source.id && <Loader2 className="size-4 animate-spin" />}
                      用这份
                    </Button>
                  )}
                </div>
                <IdentifierText className="text-muted-foreground text-xs" text={source.path} />
              </div>
            ))}

            {/* 环境变量：写给系统的那一份，别的工具与命令行也认；与上面的「用这份」不是一件事。 */}
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">环境变量 {envName}</span>
                <Badge variant={scopes && scopes.user ? "secondary" : "outline"}>
                  {scopes && scopes.user ? "用户级已设置" : "用户级未设置"}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="min-w-64 flex-1 font-mono text-xs"
                  placeholder="插件目录的绝对路径"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <Button size="sm" disabled={Boolean(envBusy)} onClick={() => void saveEnv(draft.trim())}>
                  {envBusy === "save" && <Loader2 className="size-4 animate-spin" />}
                  保存
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(envBusy) || !(scopes && scopes.user)}
                  onClick={() => void saveEnv("")}
                >
                  {envBusy === "clear" && <Loader2 className="size-4 animate-spin" />}
                  清除
                </Button>
              </div>

              <div className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                <span>
                  这次运行读到：
                  {scopes && scopes.process ? <IdentifierText text={scopes.process} /> : "未设置"}
                </span>
                <span>
                  系统里存的（用户级）：
                  {scopes && scopes.user ? <IdentifierText text={scopes.user} /> : "未设置"}
                </span>
                <span>
                  机器级：
                  {scopes && scopes.machine ? <IdentifierText text={scopes.machine} /> : "未设置"}
                  （只读，改它要管理员）
                </span>
              </div>

              <p className="text-muted-foreground text-xs">
                保存写的是 Windows「用户」环境变量：下次启动客户端时生效，别的工具与命令行也认它。
                想让这次就换，用上面那一条的「用这份」—— 它比环境变量更优先。
              </p>

              {scopes && scopes.failure && (
                <p className="text-muted-foreground text-xs">{scopes.failure}</p>
              )}

              {saved && (
                <p className="text-xs">
                  {saved === "cleared" ? "已清除。" : "已写入。"}
                  环境变量要新起的进程才读得到：关掉这个窗口、重新双击 start.cmd 吧。
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
