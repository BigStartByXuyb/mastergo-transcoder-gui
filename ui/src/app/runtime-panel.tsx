import { useCallback, useEffect, useRef, useState } from "react"
import { Download, Loader2, Terminal } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { api, type RuntimeId, type RuntimeStatus, type RuntimeTool } from "@/lib/api"
import { finishDownload } from "@/app/download-actions"
import { startDownload } from "@/lib/download-run"
import {
  describeRuntime,
  describeTool,
  downloadLabel,
  downloadableId,
  isRuntimeWorking,
  runtimeTaskLine,
  runtimeTaskPercent
} from "@/lib/runtime-state"
import { describeFailure, failureText } from "@/lib/describe-failure"
import { useSettings } from "@/lib/use-settings"

const IDLE_POLL_MS = 15000
const WORKING_POLL_MS = 1000

/*
 * 运行时这一段（挂在「运行环境」页那张卡里，没有自己的卡片外框）：跑插件的 Node.js 与 PowerShell 7
 * 各钉死一份放进安装根的 runtime\<版本>\，
 * 默认只用我们自带的那一份（客户机上装了什么不该决定我们跑哪一版）；版本目录并存、
 * 指针指向生效那一版，界面不提供切换（跑哪一版由钉死表说了算）；claude 只检测。
 */
export function RuntimePanel() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [probe, setProbe] = useState("")
  const [failure, setFailure] = useState("")
  const [working, setWorking] = useState("")

  const transferring = status ? isRuntimeWorking(status.task) : false

  /*
   * 拉一次状态：轮询用它，改完设置要立刻刷新也用它（不然要等下一轮，同页两处会短暂对不上）。
   * 卸载之后不再回写状态 —— 与 lib/use-health.ts 同一约定；抽成 refresh 之后守卫改用引用带着走。
   */
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const refresh = useCallback(async () => {
    try {
      const payload = await api.runtimeStatus()
      if (!alive.current) return
      setStatus(payload.status)
      setProbe("")
    } catch (error) {
      if (!alive.current) return
      setProbe(describeFailure(error))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), transferring ? WORKING_POLL_MS : IDLE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh, transferring])

  async function download(tool: RuntimeId) {
    setWorking(tool)
    setFailure("")
    const got = await startDownload(function () {
      return api.runtimeDownload(tool)
    })
    finishDownload(got, { setStatus, setFailure })
    setWorking("")
  }

  const summary = describeRuntime(status)
  const busy = status ? status.busy : ""
  const tools = status ? status.tools : []
  const running = status ? tools.find((item) => item.id === status.task.tool) : undefined
  const taskLine = status ? runtimeTaskLine(status.task, running ? running.label : "") : ""

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={summary.tone}>
          <Terminal className="size-3" />
          {summary.label}
        </Badge>
        {summary.note && <span className="text-muted-foreground text-xs">{summary.note}</span>}
      </div>

      {transferring && status && (
        <div className="flex flex-col gap-2">
          <Progress value={runtimeTaskPercent(status.task)} />
          <p className="text-muted-foreground text-xs">{taskLine}</p>
        </div>
      )}

      {busy && (
        <Alert>
          <AlertTitle>有任务在跑</AlertTitle>
          <AlertDescription>{busy}；跑完才能换运行时。</AlertDescription>
        </Alert>
      )}

      {probe && (
        <Alert variant="destructive">
          <AlertTitle>读不到运行时状态</AlertTitle>
          <AlertDescription>
            <ClampText text={probe} />
          </AlertDescription>
        </Alert>
      )}

      {failure && (
        <Alert variant="destructive">
          <AlertTitle>出错了</AlertTitle>
          <AlertDescription>
            <ClampText text={failure} />
          </AlertDescription>
        </Alert>
      )}

      {status && status.error && (
        <Alert variant="destructive">
          <AlertTitle>上一次没装成</AlertTitle>
          <AlertDescription>
            <ClampText text={failureText(status.error)} />
          </AlertDescription>
        </Alert>
      )}

      {tools.map((tool) => (
        <RuntimeRow
          key={tool.id}
          tool={tool}
          mirror={status ? status.mirror : ""}
          id={downloadableId(status, tool)}
          working={working === tool.id}
          onDownload={download}
        />
      ))}

      <RuntimeSourceRow mirror={status ? status.mirror : ""} onSaved={refresh} />
      <RuntimeSystemSwitch />
    </div>
  )
}

/*
 * 安装包来源：默认官方地址；内网取不到时把两个 zip 放到一个能 HTTP 访问的目录里，这里填那个基址。
 * 换源不改版本、不改哈希 —— 取回来的包仍要按钉死的 sha256 校验，填错了只会「下载失败」。
 */
function RuntimeSourceRow({ mirror, onSaved }: { mirror: string; onSaved: () => Promise<void> }) {
  const { settings, failure, save } = useSettings()
  const [value, setValue] = useState(mirror)
  const [writing, setWriting] = useState(false)
  const [saveFailure, setSaveFailure] = useState("")

  useEffect(() => {
    setValue(mirror)
  }, [mirror])

  async function persist() {
    setWriting(true)
    setSaveFailure("")
    try {
      const next = await save({ runtime: { mirror: value } })
      setValue(next.runtime.mirror)
      // 每行那个「安装包：<地址>」来自运行时状态：存完立刻刷一次，别等下一轮轮询。
      await onSaved()
      toast.success(value.trim() ? "安装包改从镜像地址取" : "安装包改回官方地址")
    }
    catch (error) {
      setSaveFailure(describeFailure(error))
    }
    finally {
      setWriting(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 border-t pt-3">
      <Label htmlFor="runtime-mirror" className="text-sm">安装包来源</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="runtime-mirror"
          className="font-mono text-xs sm:max-w-md"
          placeholder="留空＝官方地址"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button size="sm" variant="outline" disabled={writing || !settings} onClick={() => void persist()}>
          {writing ? <Loader2 className="size-4 animate-spin" /> : null}
          保存
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        默认从官方地址下载（nodejs.org 与 PowerShell 的 GitHub）。内网取不到时，把这两个 zip 放到一个能
        HTTP 访问的目录里，这里填那个基址 —— 客户端按「基址 / 文件名」取，并仍按我们钉死的 sha256 校验。
        留空即改回官方地址。
      </p>
      {(failure || saveFailure) && (
        <ClampText className="text-destructive text-xs" lines={2} text={failure || saveFailure} />
      )}
    </div>
  )
}

/*
 * 「允许用系统上那两份」开关：默认关着 —— 客户机上装的是什么，不该决定我们跑哪一版。
 * 打开之后，没装自带那份时就用系统上的，界面在每一行写清是哪一版；现读，不用重启客户端。
 */
function RuntimeSystemSwitch() {
  const { settings, failure, save } = useSettings()
  const [writing, setWriting] = useState(false)
  const [saveFailure, setSaveFailure] = useState("")

  async function toggle(checked: boolean) {
    setWriting(true)
    setSaveFailure("")
    try {
      await save({ runtime: { allowSystem: checked } })
      toast.success(checked ? "允许用系统上的 Node / PowerShell 7" : "只用客户端自带的那两份")
    }
    catch (error) {
      setSaveFailure(describeFailure(error))
    }
    finally {
      setWriting(false)
    }
  }

  return (
    <div className="flex flex-col gap-1 border-t pt-3">
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={Boolean(settings?.runtime.allowSystem)}
          disabled={!settings || writing}
          onCheckedChange={(checked) => void toggle(checked)}
        />
        允许用系统上的 Node / PowerShell 7
        {writing && <Loader2 className="size-3 animate-spin" />}
      </label>
      <p className="text-muted-foreground text-xs">
        关着时只用客户端自带的那两份（版本是我们钉死的，客户机上装了什么都不影响）；
        打开之后，缺自带那份就用系统上的，并按系统上那一版跑 —— 出问题不好复现，应急才用。
      </p>
      {(failure || saveFailure) && (
        <ClampText className="text-destructive text-xs" lines={2} text={failure || saveFailure} />
      )}
    </div>
  )
}

/* 一行：名字、钉死的那一版、现在用的是哪份、有问题才给按钮。 */
function RuntimeRow({
  tool,
  mirror,
  id,
  working,
  onDownload
}: {
  tool: RuntimeTool
  /** 配了镜像基址时把「真会去取的地址」摆出来：配错了一眼能看出来。 */
  mirror: string
  id: RuntimeId | ""
  working: boolean
  onDownload: (tool: RuntimeId) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-28 text-sm">{tool.label}</span>
        {tool.pinned ? <Badge variant="secondary">钉 v{tool.pinned}</Badge> : <Badge variant="outline">只检测</Badge>}
        <span className={tool.ready ? "text-sm" : "text-destructive text-sm"}>{describeTool(tool)}</span>
        {id && (
          <Button size="sm" variant="outline" disabled={working} onClick={() => onDownload(id)}>
            {working ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {downloadLabel(tool)}
          </Button>
        )}
      </div>
      {tool.note && (
        <ClampText className="text-muted-foreground text-xs" lines={2} text={tool.note} />
      )}
      {tool.versions.length > 1 && (
        <p className="text-muted-foreground text-xs">
          本机装过：{tool.versions.map((version) => (version === tool.active ? version + "（当前）" : version)).join("、")}
        </p>
      )}
      {mirror && tool.downloadUrl && (
        <p className="text-muted-foreground text-xs">
          安装包：<IdentifierText text={tool.downloadUrl} />
        </p>
      )}
      <IdentifierText className="text-muted-foreground text-xs" text={tool.path} />
    </div>
  )
}
