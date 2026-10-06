import { useEffect, useRef, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { TabButton } from "@/app/tab-button"
import { api, type RuntimeId, type RuntimeProbeResult, type RuntimeTool } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { downloadLabel } from "@/lib/runtime-state"
import { useSettings } from "@/lib/use-settings"

/*
 * 一份运行时的「来源」：上面两个选项，下面只显示选中那个的配置 —— 两个选项各有一块自己的设置，
 * 不叠在一起（叠在一起时，第二块看着像第一块的配置，分不清）。
 *
 *   客户端自带：状态与「下载 / 重下」，以及自带那份的安装包从哪儿下（官方 / 内网目录）
 *   系统上那份：只显示这台机器上检测到的那一版；不下载任何东西
 *
 * 用哪一份由这一处决定（按份记：Node.js 可以选系统那份、PowerShell 7 仍用自带的）。
 */

type Choice = "bundled" | "system"

export function RuntimeSourceDialog(props: {
  tool: RuntimeTool
  /** 当前生效的镜像基址（空＝官方地址）。 */
  mirror: string
  /** 正在下载这一份（外层管着，弹窗只管显示）。 */
  working: boolean
  /** 现在能不能点下载（有任务在跑、正在下载时为假）；有值就显示按钮。 */
  downloadable: RuntimeId | ""
  onDownload: (tool: RuntimeId) => void
  onClose: () => void
  /** 存完让外层刷一次运行时状态，表格里那一行跟着变。 */
  /** 存完把最新状态读回来（读一次，值本身不用看）。 */
  onSaved: () => Promise<unknown>
}) {
  const { settings, save } = useSettings()
  const id = props.tool.id

  const [choice, setChoice] = useState<Choice>("bundled")
  const [useMirror, setUseMirror] = useState(false)
  const [mirror, setMirror] = useState(props.mirror)
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const [probed, setProbed] = useState<RuntimeProbeResult[]>([])

  /*
   * 设置到齐后同步一次（只这一次，且在用户没动过手之前）：
   * 弹窗里选中的必须是「现在真的这么用」的那一项，但不能反过来覆盖用户刚点的选择。
   */
  const synced = useRef(false)
  const touched = useRef(false)

  /* 在途的那次检查也要能作废：地址一改，之前那个请求回来时不能再把旧结论贴上来。 */
  const probeSeq = useRef(0)

  useEffect(() => {
    if (!settings || synced.current || touched.current) return
    synced.current = true
    const useSystem = id === "node" ? settings.runtime.system.node : settings.runtime.system.pwsh
    setChoice(useSystem ? "system" : "bundled")
    setUseMirror(Boolean(settings.runtime.mirror))
    setMirror(settings.runtime.mirror)
  }, [settings, id])

  function pick(next: Choice) {
    touched.current = true
    setChoice(next)
    invalidateProbe()
  }

  function invalidateProbe() {
    probeSeq.current += 1
    setProbed([])
  }

  async function persist() {
    setBusy("save")
    setFailure("")
    invalidateProbe()
    try {
      const patch: Record<string, unknown> = { system: { [id]: choice === "system" } }
      if (choice === "bundled") patch.mirror = useMirror ? mirror : ""
      await save({ runtime: patch })
      await props.onSaved()
      toast.success(choice === "system" ? props.tool.label + " 改用系统上那一份" : props.tool.label + " 用客户端自带的那一份")
      props.onClose()
    }
    catch (error) {
      setFailure(describeFailure(error))
    }
    finally {
      setBusy("")
    }
  }

  /* 真去那个地址敲一下这两个文件在不在。 */
  async function check() {
    setBusy("check")
    setFailure("")
    setProbed([])
    const seq = probeSeq.current
    try {
      const payload = await api.runtimeProbe((useMirror ? mirror : "").trim())
      if (seq !== probeSeq.current) return
      setProbed(payload.results)
    }
    catch (error) {
      if (seq !== probeSeq.current) return
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
          <DialogDescription>这一份从哪儿来。默认用客户端自带的那一份 —— 版本是我们钉死的。</DialogDescription>
        </DialogHeader>

        {/* 上面两个选项：选哪个，下面就只显示哪个的配置。 */}
  <div className="flex gap-1 rounded-lg border p-1">
          <TabButton selected={choice === "bundled"} label="客户端自带" hint="版本我们钉死（推荐）" className="flex-1" onClick={() => pick("bundled")} />
          <TabButton selected={choice === "system"} label="系统上那一份" hint="按客户机上那版跑（应急）" className="flex-1" onClick={() => pick("system")} />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border p-3">
          {choice === "bundled" ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground text-xs">当前</span>
                <span>自带 v{props.tool.version || "—"}（钉 v{props.tool.pinned}）</span>
                {props.downloadable && (
                  <Button size="sm" variant="outline" disabled={props.working} onClick={() => props.onDownload(id as RuntimeId)}>
                    {props.working ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    {downloadLabel(props.tool)}
                  </Button>
                )}
              </div>
              <IdentifierText className="text-muted-foreground text-xs" text={props.tool.path} />

              <div className="border-t pt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useMirror}
                    onChange={(event) => {
                      touched.current = true
                      setUseMirror(event.target.checked)
                      invalidateProbe()
                    }}
                  />
                  安装包从内网地址取
                </label>
                {useMirror ? (
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Input
                      className="font-mono text-xs sm:max-w-sm"
                      placeholder="例如 http://10.0.0.9/runtime"
                      value={mirror}
                      onChange={(event) => {
                        setMirror(event.target.value)
                        invalidateProbe()
                      }}
                    />
                    <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void check()}>
                      {busy === "check" ? <Loader2 className="size-4 animate-spin" /> : null}
                      检查
                    </Button>
                  </div>
                ) : (
                  <p className="text-muted-foreground pt-1 text-xs">
                    官方地址：<IdentifierText text={props.tool.officialUrl} />
                  </p>
                )}
                {probed.length > 0 && (
                  <div className="flex flex-col gap-0.5 pt-2 text-xs">
                    {probed.map((item) => (
                      <span key={item.id} className={item.ok ? "text-muted-foreground" : "text-destructive"}>
                        {item.label}：{item.ok ? "找到了" : "没找到（" + (item.note || "取不到") + "）"} —— <IdentifierText text={item.url} />
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-muted-foreground pt-1 text-xs">
                  内网取不到官方地址时：把这两个 zip 按原名放到一个能 HTTP 访问的目录里（例如
                  {" "}<span className="font-mono">http://10.0.0.9/runtime</span>），填那个目录地址；目录里要有
                  {" "}<span className="font-mono">{props.tool.fileName}</span>。取回来的包仍按钉死的 sha256 校验。
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground text-xs">本机检测到</span>
                {props.tool.system.ok ? (
                  <>
                    <Badge variant="secondary">v{props.tool.system.version}</Badge>
                    <IdentifierText className="text-muted-foreground text-xs" text={props.tool.system.path} />
                  </>
                ) : (
                  <span className="text-destructive">没检测到 —— 选了它也用不了，建议改回「客户端自带」</span>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                按客户机上装的那一版跑：版本不受我们控制，出问题不好复现；只有装不上自带那份时才这么用。
              </p>
            </>
          )}
        </div>

        {failure && <ClampText className="text-destructive text-xs" lines={2} text={failure} />}
        {props.tool.note && <ClampText className="text-muted-foreground text-xs" lines={2} text={props.tool.note} />}

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
