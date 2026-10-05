import { useEffect, useState } from "react"
import { Loader2, RefreshCw, Save } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { api, type UpdateStatus } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 发布源：客户端从哪儿检查更新、从哪儿下新版本。
 *
 * 默认是内置的 GitHub 仓库；客户环境可以改成公司 GitLab（通用包）或内网静态目录。
 * 私有源（私有 GitHub / 私有 GitLab）再填一个只读 token —— 和别的凭据一样，DPAPI 加密存本机。
 * 地址拼法只有后端 lib/source.js 一处，这张卡只显示拼出来的清单地址，自己不再拼一套。
 */

/*
 * 选项来自后端的 status.kinds：后端认哪几种，这里就列哪几种，不在前端另抄一份校验名单。
 * 这里只留显示名；后端将来加一种源而这里还没来得及起名时，直接用原值当显示名。
 */
const KIND_LABELS: Record<string, string> = {
  github: "GitHub 仓库",
  gitlab: "GitLab 通用包",
  static: "静态目录（nginx / 共享盘）"
}

export function SourceCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [kind, setKind] = useState("")
  const [base, setBase] = useState("")
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const [probe, setProbe] = useState("")

  useEffect(() => {
    let stopped = false
    api
      .updateStatus()
      .then((payload) => {
        if (stopped) return
        setStatus(payload.status)
        setKind(payload.status.source.kind)
        setBase(payload.status.source.base)
      })
      .catch((error) => {
        if (!stopped) setFailure(describeFailure(error))
      })
    return () => {
      stopped = true
    }
  }, [])

  async function save(extra: Record<string, unknown>, thenCheck: boolean) {
    setBusy(thenCheck ? "check" : "save")
    setFailure("")
    setProbe("")
    try {
      await api.settingsSave({ source: Object.assign({ kind, base }, extra) })
      const payload = await api.updateStatus()
      setStatus(payload.status)
      setKind(payload.status.source.kind)
      setBase(payload.status.source.base)
      setToken("")
      if (!thenCheck) {
        toast.success("已保存发布源")
        return
      }
      const checked = await api.updateCheck()
      setStatus(checked.status)
      if (checked.status.error) setFailure(checked.status.error.message + (checked.status.error.hint ? "。" + checked.status.error.hint : ""))
      else if (checked.status.available) setProbe("远端有 v" + checked.status.available.version + "（改了 " + checked.status.available.changed + " 个文件）")
      else setProbe("远端没有更新的版本（当前 v" + checked.status.current + "）")
    }
    catch (error) {
      setFailure(describeFailure(error))
    }
    finally {
      setBusy("")
    }
  }

  const kinds: string[] = status ? status.source.kinds : []

  return (
    <Card>
      <CardHeader>
        <CardTitle>发布源</CardTitle>
        <CardDescription>
          客户端从这个地址检查更新、下载新版本。默认是内置的 GitHub 仓库；公司环境可以改成自己的 GitLab 或内网静态目录。
        </CardDescription>
        {status && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Badge variant="secondary">{status.source.kind}</Badge>
            {status.hasToken && <Badge variant="outline">已带 token</Badge>}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {failure && (
          <Alert variant="destructive">
            <AlertTitle>出错了</AlertTitle>
            <AlertDescription>
              <ClampText text={failure} />
            </AlertDescription>
          </Alert>
        )}
        {probe && <p className="text-muted-foreground text-xs">{probe}</p>}

        <div className="grid gap-3 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-1">
            <Label htmlFor="source-kind">类型</Label>
            <Select value={kind} onValueChange={setKind} disabled={!status}>
              <SelectTrigger id="source-kind" className="w-full" aria-label="发布源类型">
                <SelectValue placeholder="选类型" />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((value) => (
                  <SelectItem key={value} value={value}>
                    {KIND_LABELS[value] ?? value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="source-base">地址</Label>
            <Input
              id="source-base"
              className="font-mono text-xs"
              placeholder="https://github.com/组/仓库"
              value={base}
              onChange={(event) => setBase(event.target.value)}
            />
          </div>
        </div>

        {status && (
          <p className="text-muted-foreground text-xs">
            清单地址：<IdentifierText text={status.source.manifestUrl} />
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-64 flex-1 flex-col gap-1">
            <Label htmlFor="source-token">访问 token（私有源才需要）</Label>
            <Input
              id="source-token"
              className="font-mono text-xs"
              placeholder={status && status.hasToken ? "已保存（填新的可替换）" : "公开源留空"}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>
          <Button variant="outline" disabled={Boolean(busy) || !status} onClick={() => void save({ token }, false)}>
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
          <Button disabled={Boolean(busy) || !status} onClick={() => void save({ token }, true)}>
            {busy === "check" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            保存并检查
          </Button>
          {status && status.hasToken && (
            <Button
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() => void save({ clearToken: true }, false)}
            >
              清除 token
            </Button>
          )}
        </div>

        <p className="text-muted-foreground text-xs">
          GitHub 填仓库地址（`https://github.com/组/仓库`）；GitLab 填项目地址（`https://git.公司.com/组/仓库`，走通用包）；
          静态目录填目录地址（更新文件由发布脚本铺上去）。填完点「保存并检查」验证一次。
        </p>
      </CardContent>
    </Card>
  )
}
