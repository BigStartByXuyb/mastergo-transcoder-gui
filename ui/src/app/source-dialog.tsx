import { useState } from "react"
import { Loader2, RefreshCw, Save } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { api, type UpdateStatus } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { describeUpdate } from "@/lib/update-state"

/*
 * 改「程序更新从哪儿取」。
 *
 * 类型下拉的选项来自后端的 status.source.kinds：后端认哪几种就列哪几种，前端只留显示名
 * （认不出的类型直接用原值当显示名）。地址怎么拼只有后端 lib/source.js 一处，这里只把拼出来的
 * 清单地址照实显示，不再自己拼一套。
 */
const KIND_LABELS: Record<string, string> = {
  github: "GitHub 仓库",
  gitlab: "GitLab 通用包",
  static: "静态目录（nginx / 共享盘）"
}

export function SourceDialog(props: {
  /** 打开时的现状：用它预填类型与地址；token 只显示「有没有」，不回显值。 */
  status: UpdateStatus
  onClose: () => void
  /** 存完把最新状态交回外层，卡片上那一行跟着变。 */
  onStatus: (status: UpdateStatus) => void
}) {
  const [kind, setKind] = useState(props.status.source.kind)
  const [base, setBase] = useState(props.status.source.base)
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const [probe, setProbe] = useState("")
  const [current, setCurrent] = useState(props.status)

  async function save(extra: Record<string, unknown>, thenCheck: boolean) {
    setBusy(thenCheck ? "check" : "save")
    setFailure("")
    setProbe("")
    try {
      await api.settingsSave({ source: Object.assign({ kind, base }, extra) })
      const payload = await api.updateStatus()
      setCurrent(payload.status)
      props.onStatus(payload.status)
      setKind(payload.status.source.kind)
      setBase(payload.status.source.base)
      setToken("")
      if (!thenCheck) {
        toast.success("已保存发布源")
        return
      }
      /*
       * 验完照「程序更新」卡片同一处口径报一句：四态翻成一句人话的事只有 describeUpdate 一处，
       * 这里不另写一套（不然同一份状态在两处说不一样的话）。
       */
      const checked = await api.updateCheck()
      setCurrent(checked.status)
      props.onStatus(checked.status)
      const summary = describeUpdate(checked.status)
      if (checked.status.error) {
        setFailure(checked.status.error.message + (checked.status.error.hint ? "。" + checked.status.error.hint : ""))
      }
      else setProbe(summary.note ? summary.label + "；" + summary.note : summary.label)
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
          <DialogTitle>修改发布源</DialogTitle>
          <DialogDescription>
            程序更新从这个地址检查有没有新版、从这儿把新版本下回来。默认是内置的 GitHub 仓库；
            公司环境可以改成自己的 GitLab 或内网静态目录。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{current.source.kind}</Badge>
            {current.hasToken && <Badge variant="outline">已带 token</Badge>}
          </div>
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
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="source-kind" className="w-full" aria-label="发布源类型">
                  <SelectValue placeholder="选类型" />
                </SelectTrigger>
                <SelectContent>
                  {current.source.kinds.map((value) => (
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

          <p className="text-muted-foreground text-xs">
            清单地址：<IdentifierText text={current.source.manifestUrl} />
          </p>

          <div className="flex flex-col gap-1">
            <Label htmlFor="source-token">访问 token（私有源才需要）</Label>
            <Input
              id="source-token"
              className="font-mono text-xs"
              placeholder={current.hasToken ? "已保存（填新的可替换）" : "公开源留空"}
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </div>

          <p className="text-muted-foreground text-xs">
            GitHub 填仓库地址（`https://github.com/组/仓库`）；GitLab 填项目地址（`https://git.公司.com/组/仓库`，走通用包）；
            静态目录填目录地址（更新文件由发布脚本铺上去）。填完点「保存并检查」验证一次。
          </p>
        </div>

        <DialogFooter className="flex-wrap sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={Boolean(busy)} onClick={() => void save({ token }, false)}>
              {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存
            </Button>
            <Button disabled={Boolean(busy)} onClick={() => void save({ token }, true)}>
              {busy === "check" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              保存并检查
            </Button>
            {current.hasToken && (
              <Button variant="ghost" disabled={Boolean(busy)} onClick={() => void save({ clearToken: true }, false)}>
                清除 token
              </Button>
            )}
          </div>
          <Button variant="secondary" disabled={Boolean(busy)} onClick={props.onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
