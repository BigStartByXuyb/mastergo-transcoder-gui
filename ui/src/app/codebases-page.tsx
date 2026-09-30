import { useState } from "react"
import { FolderSearch, Loader2, Plus, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ClampText } from "@/app/clamp-text"
import { PixelLoader } from "@/app/pixel-loader"
import { api, type CodebaseEntry, type Settings } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { useSettings } from "@/lib/use-settings"

/*
 * 代码库与提示词：告诉 AI「有哪些库、各是什么、放在哪」，再给它一段你写死的规矩。
 *
 * 每次提问都会把它们拼在最前面（见 lib/agent-context.js），所以这里填得越清楚，
 * 它越不用猜。路径不做存在性校验：库可能在别的盘，也可能是别人交过来的。
 */
export function CodebasesPage() {
  const { settings, failure, save } = useSettings()

  if (!settings) {
    return failure ? (
      <Alert variant="destructive">
        <AlertTitle>读不到设置</AlertTitle>
        <AlertDescription>
          <ClampText text={failure} />
        </AlertDescription>
      </Alert>
    ) : (
      <PixelLoader text="请稍等，正在读取代码库与提示词" className="py-10" />
    )
  }

  // 存下来的内容一变就重挂表单：初值只认已读到的那份，不会把正在打的字盖掉。
  return (
    <CodebasesForm
      key={JSON.stringify(settings.codebases) + "|" + settings.agent.systemPrompt}
      settings={settings}
      save={save}
    />
  )
}

function CodebasesForm(props: { settings: Settings; save: (patch: unknown) => Promise<Settings> }) {
  const [rows, setRows] = useState<CodebaseEntry[]>(props.settings.codebases)
  const [prompt, setPrompt] = useState(props.settings.agent.systemPrompt)
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const [picking, setPicking] = useState(-1)

  function patchRow(index: number, patch: Partial<CodebaseEntry>) {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)))
  }

  async function browse(index: number) {
    setPicking(index)
    setFailure("")
    try {
      const picked = await api.pickFolder()
      if (picked.path) patchRow(index, { path: picked.path })
      else if (picked.reason) toast.info(picked.reason)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setPicking(-1)
    }
  }

  async function saveAll() {
    setBusy("save")
    setFailure("")
    try {
      await props.save({ codebases: rows, agent: { systemPrompt: prompt } })
      toast.success("已保存")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>代码库</CardTitle>
          <CardDescription>
            把你会用到的库在这里登记一次：它在哪、是什么库、要注意什么。之后每次提问都会带上这份清单，
            AI 需要时会去这些目录里读文件，不用你每次交代。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.length === 0 && (
            <p className="text-muted-foreground text-sm">
              还没有登记。点下面的「添加一个库」，填上路径与它是什么库就行。
            </p>
          )}

          {rows.map((row, index) => (
            <div key={index} className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Label>代码库路径</Label>
                  <Input
                    spellCheck={false}
                    className="font-mono text-xs"
                    placeholder="例如 …\MaxWell.SSDPages（也可以点右边「浏览…」）"
                    value={row.path}
                    onChange={(event) => patchRow(index, { path: event.target.value })}
                  />
                </div>
                <Button variant="outline" disabled={picking >= 0} onClick={() => void browse(index)}>
                  {picking === index ? <Loader2 className="size-4 animate-spin" /> : <FolderSearch className="size-4" />}
                  浏览…
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>是什么库</Label>
                  <Input
                    spellCheck={false}
                    placeholder="例如 MTSLG IOContorl 页面工程"
                    value={row.name}
                    onChange={(event) => patchRow(index, { name: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>说明（可选）</Label>
                  <Input
                    spellCheck={false}
                    placeholder="例如 页面 XML 与 Layout 注册都在这里"
                    value={row.note}
                    onChange={(event) => patchRow(index, { note: event.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={row.enabled} onCheckedChange={(value) => patchRow(index, { enabled: value })} />
                  这次也带上它
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
                >
                  <Trash2 className="size-3.5" />
                  删掉这个库
                </Button>
              </div>
            </div>
          ))}

          <div>
            <Button
              variant="outline"
              onClick={() => setRows((current) => [...current, { path: "", name: "", note: "", enabled: true }])}
            >
              <Plus className="size-4" />
              添加一个库
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>系统提示词</CardTitle>
          <CardDescription>
            每次提问都会先给 AI 看这一段。写你希望它一直遵守的规矩，比如「回答只用中文」「不要动 Generated 里的东西以外」。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            rows={5}
            spellCheck={false}
            placeholder="例如：这个工程是 MTSLG IOContorl 的页面工程；改动前先说明你打算改哪几个文件。"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </CardContent>
      </Card>

      {failure && (
        <Alert variant="destructive">
          <AlertTitle>出错了</AlertTitle>
          <AlertDescription>
            <ClampText text={failure} />
          </AlertDescription>
        </Alert>
      )}

      <div>
        <Button disabled={busy !== ""} onClick={() => void saveAll()}>
          {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存
        </Button>
      </div>
    </div>
  )
}
