import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { api, type PluginEnvScopes } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 环境变量 MASTERGO_PLUGIN_ROOT：写给系统的那一份。
 *
 * 与上面「用这份」不是一件事：那份是本客户端内部立刻生效，这份要新起的进程才读到，
 * 所以三个作用域分开显示（这次运行读到的 / 系统里存的用户级 / 机器级），界面上不合并成一个值。
 * 名字与当前值都由后端给（GET /api/plugin/env），前端不另存一份常量。
 */
export function PluginEnvPanel() {
  const [name, setName] = useState("")
  const [scopes, setScopes] = useState<PluginEnvScopes | null>(null)
  const [draft, setDraft] = useState("")
  // "" / "saved" / "cleared"：存完要说清这次是写进去了还是清掉了。
  const [saved, setSaved] = useState("")
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")

  useEffect(() => {
    let stopped = false
    async function load() {
      try {
        const payload = await api.pluginEnv()
        if (stopped) return
        setName(payload.name)
        setScopes(payload.envScopes)
        setDraft(payload.envScopes.user || "")
      } catch (error) {
        if (!stopped) setFailure(describeFailure(error))
      }
    }
    void load()
    return () => {
      stopped = true
    }
  }, [])

  /* 空串＝清掉这个变量。写完由新起的进程读到，所以要说清「重开客户端才生效」。 */
  async function save(value: string) {
    setBusy(value ? "save" : "clear")
    setFailure("")
    try {
      const payload = await api.pluginEnvSave(value)
      setScopes(payload.envScopes)
      setDraft(payload.envScopes.user || "")
      setSaved(value ? "saved" : "cleared")
      if (payload.unsupported) toast.info(payload.envScopes.failure)
      else if (!value) toast.success("已清掉环境变量 " + payload.name)
      else if (payload.resolves) toast.success("已写入环境变量；重启客户端后生效")
      else toast.warning("已写入，但这个位置现在没有插件")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">环境变量{name ? " " + name : ""}</span>
        {scopes && (
          <Badge variant={scopes.user ? "secondary" : "outline"}>
            {scopes.user ? "用户级已设置" : "用户级未设置"}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-64 flex-1 font-mono text-xs"
          placeholder="插件目录的绝对路径"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button size="sm" disabled={Boolean(busy)} onClick={() => void save(draft.trim())}>
          {busy === "save" && <Loader2 className="size-4 animate-spin" />}
          保存
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={Boolean(busy) || !(scopes && scopes.user)}
          onClick={() => void save("")}
        >
          {busy === "clear" && <Loader2 className="size-4 animate-spin" />}
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

      {scopes && scopes.failure && <p className="text-muted-foreground text-xs">{scopes.failure}</p>}

      {failure && (
        <p className="text-destructive text-xs">
          <ClampText lines={2} text={failure} />
        </p>
      )}

      {saved && (
        <p className="text-xs">
          {saved === "cleared" ? "已清除。" : "已写入。"}
          环境变量要新起的进程才读得到：关掉这个窗口、重新双击 start.cmd 吧。
        </p>
      )}
    </div>
  )
}
