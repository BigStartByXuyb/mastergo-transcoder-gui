import { useEffect, useState } from "react"
import { KeyRound, Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { api, type Settings } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { useHealth } from "@/lib/use-health"
import { CodexCard } from "@/app/codex-card"
import { UpdateCard } from "@/app/update-card"

const CUSTOM = "custom"

export function SettingsPage() {
  const { health, offline } = useHealth(10000)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [provider, setProvider] = useState(CUSTOM)
  const [baseUrl, setBaseUrl] = useState("")
  const [model, setModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [writing, setWriting] = useState(false)
  const [failure, setFailure] = useState("")
  const [probe, setProbe] = useState("")

  /* 读设置失败与保存失败分开记：后端回来之后自己重读一次，不用刷新页面。 */
  useEffect(() => {
    if (offline) return
    let stopped = false
    api
      .settingsGet()
      .then((payload) => {
        if (stopped) return
        setSettings(payload.settings)
        setProvider(payload.settings.ai.provider || CUSTOM)
        setBaseUrl(payload.settings.ai.baseUrl)
        setModel(payload.settings.ai.model)
        setProbe("")
      })
      .catch((error) => {
        if (!stopped) setProbe(describeFailure(error))
      })
    return () => {
      stopped = true
    }
  }, [offline])

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

  /* 写盘开关是即时生效的单个布尔，不走「保存」按钮。 */
  async function toggleWrite(checked: boolean) {
    setWriting(true)
    setFailure("")
    try {
      const payload = await api.settingsSave({ agent: { allowWrite: checked } })
      setSettings(payload.settings)
      toast.success(checked ? "已允许 agent 改工程文件" : "已恢复只读")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setWriting(false)
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

          {(offline || probe || failure) && (
            <Alert variant="destructive">
              <AlertTitle>出错了</AlertTitle>
              <AlertDescription>
                <ClampText text={offline ? "连不上本地服务，暂时读不到设置。" : probe || failure} />
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
          <CardTitle>Agent 写盘</CardTitle>
          <CardDescription>
            关着时只读；开着才允许它在「对话」里直接改工程文件。Windows 上 Codex 沙箱不放行只读命令，
            所以只读是给它的约定，不是系统隔离。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={Boolean(settings?.agent.allowWrite)} onCheckedChange={(checked) => void toggleWrite(checked)} />
            允许 agent 直接改工程文件
            {writing && <Loader2 className="size-3 animate-spin" />}
          </label>
          <p className="text-muted-foreground text-xs">
            关着时它也能帮你读代码、看日志、给方案，只是不去改文件。
          </p>
        </CardContent>
      </Card>

      <CodexCard />

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
                  <IdentifierText text={health.plugin.engine} />
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

      <UpdateCard />
    </div>
  )
}
