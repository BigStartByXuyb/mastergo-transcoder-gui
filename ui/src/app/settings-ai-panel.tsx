import { useState } from "react"
import { KeyRound, Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import { ClampText } from "@/app/clamp-text"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Settings } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { useSettings } from "@/lib/use-settings"

const CUSTOM = "custom"

/*
 * 模型：只给「待确认」页出候选（图标命名、文案译文），不接管流程，写进产物前一律要人确认。
 * key 用 Windows DPAPI（当前用户）加密后存在安装目录的 credentials 里，不进产物、不进日志。
 *
 * 表单是受控的，初值只能用「已经读到的那份设置」：读到之后按存的那份挂一次表单，
 * 存完设置变了就按新值重挂 —— 不写「settings 变了再把输入框对齐回去」那种 effect，
 * 否则用户正在打字时一次保存回包就能把光标下的字覆盖掉。
 */
export function SettingsAiPanel() {
  const { settings, failure, save } = useSettings()

  return (
    <Card>
      <CardHeader>
        <CardTitle>模型</CardTitle>
        <CardDescription>
          用于「待确认」页出候选（图标命名、文案译文）。只做一次调用，不接管流程；写进产物前一律要你确认。
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {!settings && <Badge variant="outline">读取中…</Badge>}
          {settings?.ai.hasKey && (
            <Badge variant="secondary">
              <KeyRound className="size-3" />
              key 已保存（DPAPI 加密）
            </Badge>
          )}
          {settings && !settings.ai.hasKey && <Badge variant="outline">还没有 key</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {settings ? (
          <AiForm
            key={settings.ai.provider + "|" + settings.ai.baseUrl + "|" + settings.ai.model}
            settings={settings}
            save={save}
            loadFailure={failure}
          />
        ) : failure ? (
          <Alert variant="destructive">
            <AlertTitle>出错了</AlertTitle>
            <AlertDescription>
              <ClampText text={failure} />
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}

function AiForm(props: { settings: Settings; save: (patch: unknown) => Promise<Settings>; loadFailure: string }) {
  const [provider, setProvider] = useState(props.settings.ai.provider || CUSTOM)
  const [baseUrl, setBaseUrl] = useState(props.settings.ai.baseUrl)
  const [model, setModel] = useState(props.settings.ai.model)
  const [apiKey, setApiKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")

  function pickProvider(id: string) {
    setProvider(id)
    const preset = props.settings.providers.find((item) => item.id === id)
    if (preset) {
      setBaseUrl(preset.baseUrl)
      setModel(preset.model)
    }
  }

  async function submit() {
    setBusy(true)
    setFailure("")
    try {
      await props.save({
        ai: {
          provider: provider === CUSTOM ? "" : provider,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
        }
      })
      setApiKey("")
      toast.success("已保存")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label>厂商</Label>
          <Select value={provider} onValueChange={pickProvider}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.settings.providers.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM}>自定义（任何 OpenAI 兼容服务）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ai-model">模型名</Label>
          <Input id="ai-model" spellCheck={false} value={model} onChange={(event) => setModel(event.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ai-base">Base URL</Label>
        <Input
          id="ai-base"
          spellCheck={false}
          placeholder="https://api.example.com"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ai-key">API key</Label>
        <Input
          id="ai-key"
          type="password"
          spellCheck={false}
          placeholder={props.settings.ai.hasKey ? "留空则保持不变" : "sk-…"}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          用 Windows DPAPI（当前用户）加密后存在安装目录的 credentials 里，不写进任何产物、不进日志。
        </p>
      </div>

      {(failure || props.loadFailure) && (
        <Alert variant="destructive">
          <AlertTitle>出错了</AlertTitle>
          <AlertDescription>
            <ClampText text={failure || props.loadFailure} />
          </AlertDescription>
        </Alert>
      )}

      <div>
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存
        </Button>
      </div>
    </>
  )
}
