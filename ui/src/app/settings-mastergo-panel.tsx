import { useState } from "react"
import { Eraser, FileKey, Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import { ClampText } from "@/app/clamp-text"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { describeFailure } from "@/lib/describe-failure"
import { useSettings } from "@/lib/use-settings"

/*
 * MasterGo token：取设计稿（页面名、图层、图标几何）要用的凭证。
 *
 * 界面只说两件事 —— 本机存过没有、现在实际生效的是哪一份。这两件事可以不一致：
 * 命令行与环境变量优先于本机保存；不一致时必须写出来，否则用户会以为「我存了却没用上」。
 */
export function SettingsMastergoPanel() {
  const { settings, failure, save } = useSettings()
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState("")
  const [saveFailure, setSaveFailure] = useState("")

  const hasToken = Boolean(settings?.mastergo.hasToken)
  const sourceLabel = settings?.mastergo.sourceLabel ?? ""
  const shadowed = hasToken && Boolean(sourceLabel) && settings?.mastergo.source !== "saved"

  async function put() {
    const value = token.trim()
    if (!value) {
      setSaveFailure("先填一个 token 再保存。")
      return
    }
    setBusy("save")
    setSaveFailure("")
    try {
      await save({ mastergo: { token: value } })
      setToken("")
      toast.success("已保存")
    } catch (error) {
      setSaveFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  async function clear() {
    setBusy("clear")
    setSaveFailure("")
    try {
      await save({ mastergo: { clearToken: true } })
      toast.success("已清除本机保存的 token")
    } catch (error) {
      setSaveFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MasterGo token</CardTitle>
        <CardDescription>读取设计稿要用的凭证。填一次就够，之后每次转码都用它。</CardDescription>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {hasToken ? (
            <Badge variant="secondary">
              <FileKey className="size-3" />
              本机已保存
            </Badge>
          ) : (
            <Badge variant="outline">本机没存过</Badge>
          )}
          {sourceLabel ? (
            <Badge variant="outline">当前生效：{sourceLabel}</Badge>
          ) : (
            <Badge variant="destructive">当前没有可用 token</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!sourceLabel && (
          <Alert>
            <AlertTitle>还没有 token</AlertTitle>
            <AlertDescription>没有它读不到设计稿。在这里填一次即可。</AlertDescription>
          </Alert>
        )}

        {shadowed && (
          <Alert>
            <AlertTitle>本机这份没在用</AlertTitle>
            <AlertDescription>现在生效的是「{sourceLabel}」，不是本机保存的这一份。</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="mg-token">Token</Label>
          <Input
            id="mg-token"
            type="password"
            spellCheck={false}
            placeholder={hasToken ? "留空则保持不变" : "mg_…"}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <p className="text-muted-foreground text-xs">token 只加密存在本机，不会写进工程，也不会出现在日志里。</p>
        </div>

        {(failure || saveFailure) && (
          <Alert variant="destructive">
            <AlertTitle>出错了</AlertTitle>
            <AlertDescription>
              <ClampText text={saveFailure || failure} />
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={Boolean(busy)} onClick={() => void put()}>
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
          <Button variant="outline" disabled={Boolean(busy) || !hasToken} onClick={() => void clear()}>
            {busy === "clear" ? <Loader2 className="size-4 animate-spin" /> : <Eraser className="size-4" />}
            清除本机保存
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
