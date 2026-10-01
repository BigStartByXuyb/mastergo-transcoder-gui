import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BusyOverlay } from "@/app/busy-overlay"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { ApiFailure, api, type PluginEnvScopes } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { waitForService } from "@/lib/restart-watch"

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
      if (payload.envScopes.unsupported) {
        // 本机没有这一层（非 Windows）：不能同时说「已写入」。
        setSaved("")
        toast.info(payload.envScopes.failure)
      }
      else if (!value) {
        setSaved("cleared")
        toast.success("已清掉环境变量 " + payload.name)
      }
      else {
        setSaved("saved")
        if (payload.resolves) toast.success("已写入环境变量；重启客户端后生效")
        else toast.warning("已写入，但这个位置现在没有插件")
      }
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  /*
   * 让新的一份真的读到刚存的值：监督进程收到这个信号会重读注册表再起子进程。
   * 起不来的那几秒连不上属于预期，所以探活用「能取到环境变量」当判据，起来之后再刷新页面。
   */
  async function applyNow() {
    setBusy("restart")
    setFailure("")
    try {
      await api.clientRestart(true)
    }
    catch (error) {
      // 只有「这一份被它自己关掉」才算预期（连接断在半路）；被拒（有任务在跑 / 不是监督进程拉的）要如实说。
      if (!(error instanceof ApiFailure) || error.code !== "OFFLINE") {
        setBusy("")
        setFailure(describeFailure(error))
        return
      }
    }
    /*
     * 等新的一份起来就刷新：先等 2 秒，免得探到还没退的旧进程（它也能回答）。
     * 这里不猜「新的一份该读到什么」——那是后端的事（用户级还是机器级、继承来的临时值要不要留，
     * 口径都在 lib/launch.js），界面刷新后如实显示读到的是哪一份。
     * 轮询骨架与超时口径在 lib/restart-watch.ts，与「切版本」那条路共用一份。
     */
    const back = await waitForService({
      probe: function () { return api.pluginEnv() },
      initialDelayMs: 2000
    })
    if (back) {
      window.location.reload()
      return
    }
    setBusy("")
    setFailure("重启之后没能连上本地服务：关掉这个窗口、重新双击 start.cmd。")
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      {busy === "restart" && <BusyOverlay text="请稍等，正在重启客户端" note="界面马上回来，不用你关窗口。" />}
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

      {/* 存了但这次没读到 = 还没重启；两行不一样时必须点破，否则用户会以为存了就等于生效了。 */}
      {scopes && scopes.user && scopes.user !== scopes.process && (
        <p className="text-xs">
          这两个值不一样：现在这次运行用的是「这次运行读到」那一份；重启客户端之后才会改用系统里存的那一份。
        </p>
      )}

      {/* 这次读到了、界面里却没存过：值是启动它的那个环境带进来的（在别处设的，或机器级）。 */}
      {scopes && !scopes.user && scopes.process && (
        <p className="text-xs">
          这次运行读到的那份不是在这里存的：它是启动客户端时的环境带进来的（在别处设过、或机器级的那一份）。
        </p>
      )}

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
        <div className="flex flex-wrap items-center gap-2">
          {saved === "cleared" ? "已清除。" : "已写入。"}
          <span className="text-muted-foreground text-xs">环境变量要新起的进程才读得到。</span>
          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void applyNow()}>
            {busy === "restart" && <Loader2 className="size-4 animate-spin" />}
            重启客户端让它生效
          </Button>
        </div>
      )}
    </div>
  )
}
