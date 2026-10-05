import { useEffect, useRef, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { api, type RuntimeId, type RuntimeProbeResult, type RuntimeTool } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { describeTool, downloadLabel } from "@/lib/runtime-state"
import { useSettings } from "@/lib/use-settings"

/*
 * 一份运行时的「来源」：这个弹窗回答两层问题，别混在一起 ——
 *   ① 用哪一份：客户端自带（推荐，版本我们钉死）还是系统上那份（应急，版本不受控）
 *   ② 自带那份的安装包从哪儿下：官方地址，还是内网镜像目录（+ 检查）
 * 第二层只在选「自带」时有意义 —— 用系统那份根本不下载。
 */

export function RuntimeSourceDialog(props: {
  tool: RuntimeTool
  /** 当前生效的镜像基址（空＝官方地址）。 */
  mirror: string
  working: boolean
  onDownload: (tool: RuntimeId) => void
  onClose: () => void
  /** 存完让外层刷一次运行时状态，表格里的「来源」跟着变。 */
  onSaved: () => Promise<void>
}) {
  const { settings, save } = useSettings()
  const id = props.tool.id
  // 装过又自检通过的那一份不用给下载按钮；其余只要有 id 就能点「下载 / 重下」。
  const downloadable: RuntimeId | "" = id === "claude" ? "" : (props.tool.installed && props.tool.ready ? "" : id)

  const [useSystem, setUseSystem] = useState(false)
  const [useMirror, setUseMirror] = useState(Boolean(props.mirror))
  const [mirror, setMirror] = useState(props.mirror)
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const [probed, setProbed] = useState<RuntimeProbeResult[]>([])

  const official = props.tool.officialUrl

  /*
   * 设置到齐后同步一次：弹窗里选中的必须是「现在真的这么用」的那一项。
   * 两条边界都要挡：① 不能每次 settings 变化都同步；② 用户在设置到达之前就点过的话，别覆盖他的选择。
   */
  const synced = useRef(false)
  const touched = useRef(false)
  useEffect(() => {
    if (!settings || synced.current || touched.current) return
    synced.current = true
    setUseSystem(id === "node" ? settings.runtime.system.node : settings.runtime.system.pwsh)
    setUseMirror(Boolean(settings.runtime.mirror))
    setMirror(settings.runtime.mirror)
  }, [settings, id])

  function chooseSystem(value: boolean) {
    touched.current = true
    setUseSystem(value)
  }

  function chooseMirror(value: boolean) {
    touched.current = true
    setUseMirror(value)
  }

  async function persist() {
    setBusy("save")
    setFailure("")
    setProbed([])
    try {
      const patch: Record<string, unknown> = { system: { [id]: useSystem } }
      if (!useSystem) patch.mirror = useMirror ? mirror : ""
      const next = await save({ runtime: patch })
      await props.onSaved()
      toast.success(useSystem ? props.tool.label + " 改用系统上那一份" : props.tool.label + " 用客户端自带的那一份")
      setMirror(next.runtime.mirror)
      props.onClose()
    }
    catch (error) {
      setFailure(describeFailure(error))
    }
    finally {
      setBusy("")
    }
  }

  /* 真去那个地址敲一下这两个文件在不在（地址框里没填就用已保存的那个）。 */
  async function check() {
    setBusy("check")
    setFailure("")
    setProbed([])
    try {
      const payload = await api.runtimeProbe((useMirror ? mirror : "").trim())
      setProbed(payload.results)
    }
    catch (error) {
      setFailure(describeFailure(error))
    }
    finally {
      setBusy("")
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{props.tool.label} 的来源</DialogTitle>
          <DialogDescription>
            这一份从哪儿来。默认用客户端自带的那一份 —— 版本是我们钉死的，客户机上装什么都不影响。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* ① 用哪一份 */}
          <button
            type="button"
            onClick={() => chooseSystem(false)}
            className={"rounded-lg border p-3 text-left " + (useSystem ? "text-muted-foreground" : "bg-accent/50")}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              客户端自带的那一份（推荐）
              {!useSystem && <Badge variant="secondary">现在选的</Badge>}
            </span>
            <span className="text-muted-foreground text-xs">版本由我们钉死；流水线出问题好复现。</span>
          </button>

          {!useSystem && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>当前：{describeTool(props.tool)}</span>
                {downloadable && (
                  <Button size="sm" variant="outline" disabled={props.working} onClick={() => props.onDownload(downloadable)}>
                    {props.working ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {downloadLabel(props.tool)}
                  </Button>
                )}
              </div>
              <IdentifierText className="text-muted-foreground text-xs" text={props.tool.path} />

              <label className="flex items-center gap-2 pt-1 text-sm">
                <input type="checkbox" checked={useMirror} onChange={(event) => chooseMirror(event.target.checked)} />
                安装包从内网地址取（关着＝官方地址）
              </label>
              {useMirror ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="font-mono text-xs sm:max-w-sm"
                    placeholder="例如 http://10.0.0.9/runtime"
                    value={mirror}
                    onChange={(event) => {
                      setMirror(event.target.value)
                      setProbed([])
                    }}
                  />
                  <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void check()}>
                    {busy === "check" ? <Loader2 className="size-4 animate-spin" /> : null}
                    检查
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">
                  官方地址：<IdentifierText text={official} />
                </p>
              )}
              {probed.length > 0 && (
                <div className="flex flex-col gap-0.5 text-xs">
                  {probed.map((item) => (
                    <span key={item.id} className={item.ok ? "text-muted-foreground" : "text-destructive"}>
                      {item.label}：{item.ok ? "找到了" : "没找到（" + (item.note || "取不到") + "）"} —— <IdentifierText text={item.url} />
                    </span>
                  ))}
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                内网取不到官方地址时：把这两个 zip 按原名放到一个能 HTTP 访问的目录里（例如
                {" "}<span className="font-mono">http://10.0.0.9/runtime</span>），填那个<strong>目录</strong>的地址；
                目录里要有 <span className="font-mono">{props.tool.fileName}</span>。取回来的包仍按钉死的 sha256 校验。
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => chooseSystem(true)}
            className={"rounded-lg border p-3 text-left " + (useSystem ? "bg-accent/50" : "text-muted-foreground")}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              用系统上那一份（应急）
              {useSystem && <Badge variant="secondary">现在选的</Badge>}
            </span>
            <span className="text-muted-foreground text-xs">
              按客户机上装的那一版跑，版本不受我们控制、出问题不好复现。没装自带那份时才用它。
            </span>
          </button>

          {useSystem && (
            <div className="text-muted-foreground rounded-lg border p-3 text-xs">
              {props.tool.system.ok
                ? "这台机器上检测到 v" + props.tool.system.version + "：" + props.tool.system.path
                : "这台机器上没检测到系统那份 —— 选了它也用不了，建议改回「客户端自带」。"}
            </div>
          )}

          {failure && <ClampText className="text-destructive text-xs" lines={2} text={failure} />}
          {/* 那一行现在是什么状态、还缺什么 —— 文案由 lib/runtime-state 与后端给，这里照实显示。 */}
          {props.tool.note && <ClampText className="text-muted-foreground text-xs" lines={2} text={props.tool.note} />}
        </div>

        <DialogFooter className="flex-wrap sm:justify-between">
          <Button variant="outline" disabled={Boolean(busy) || !settings} onClick={() => void persist()}>
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null}
            保存
          </Button>
          <Button variant="secondary" disabled={Boolean(busy)} onClick={props.onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
