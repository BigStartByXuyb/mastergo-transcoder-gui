import { useEffect, useState } from "react"
import { KeyRound, Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ClampText } from "@/app/clamp-text"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, type Settings } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { useHealth } from "@/lib/use-health"

const CUSTOM = "custom"

export function SettingsPage() {
  const { health, offline } = useHealth(10000)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [provider, setProvider] = useState(CUSTOM)
  const [baseUrl, setBaseUrl] = useState("")
  const [model, setModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")

  useEffect(() => {
    api
      .settingsGet()
      .then((payload) => {
        setSettings(payload.settings)
        setProvider(payload.settings.ai.provider || CUSTOM)
        setBaseUrl(payload.settings.ai.baseUrl)
        setModel(payload.settings.ai.model)
      })
      .catch((error) => setFailure(describeFailure(error)))
  }, [])

  function pickProvider(id: string) {
    setProvider(id)
    const preset = settings?.providers.find((item) => item.id === id)
    if (preset) {
      setBaseUrl(preset.baseUrl)
      setModel(preset.model)
    }
  }

  async function save() {
    setBusy(true)
    setFailure("")
    try {
      const payload = await api.settingsSave({
        ai: {
          provider: provider === CUSTOM ? "" : provider,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
        }
      })
      setSettings(payload.settings)
      setApiKey("")
      toast.success("已保存")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>模型</CardTitle>
          <CardDescription>
            用于「待确认」页出候选（图标命名、文案译文）。只做一次调用，不接管流程；写进产物前一律要你确认。
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {settings?.ai.hasKey ? (
              <Badge variant="secondary">
                <KeyRound className="size-3" />
                key 已保存（DPAPI 加密）
              </Badge>
            ) : (
              <Badge variant="outline">还没有 key</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>厂商</Label>
              <Select value={provider} onValueChange={pickProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(settings?.providers ?? []).map((item) => (
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
              placeholder={settings?.ai.hasKey ? "留空则保持不变" : "sk-…"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              用 Windows DPAPI（当前用户）加密后存在安装目录的 credentials 里，不写进任何产物、不进日志。
            </p>
          </div>

          {failure && (
            <Alert variant="destructive">
              <AlertTitle>出错了</AlertTitle>
              <AlertDescription>
                <ClampText text={failure} />
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>运行环境</CardTitle>
          <CardDescription>当前进程实际加载的插件与引擎。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {offline && <p className="text-destructive text-sm">连不上本地服务。</p>}
          {!offline && !health && <p className="text-muted-foreground text-sm">读取中…</p>}
          {health && (
            <dl className="grid gap-4">
              <div>
                <dt className="text-muted-foreground text-xs">客户端版本</dt>
                <dd className="text-sm">
                  <Badge variant="secondary">v{health.version}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">插件</dt>
                <dd className="text-sm break-all">
                  {health.plugin.root}
                  {health.plugin.version ? "（v" + health.plugin.version + "）" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">控件查询引擎</dt>
                <dd className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={health.plugin.engineExists ? "secondary" : "destructive"}>
                    {health.plugin.engineExists ? "已找到" : "缺失"}
                  </Badge>
                  <span className="break-all">{health.plugin.engine}</span>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">流水线入口</dt>
                <dd className="text-sm">
                  <Badge variant={health.plugin.runAllExists ? "secondary" : "destructive"}>
                    {health.plugin.runAllExists ? "已找到" : "缺失"}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">已登记页面帧</dt>
                <dd className="text-sm">{health.frames.length}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
