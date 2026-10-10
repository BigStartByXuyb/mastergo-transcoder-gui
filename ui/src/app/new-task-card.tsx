import { Loader2, Play, RefreshCw, Square } from "lucide-react"
import type { ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ClampText } from "@/app/clamp-text"
import { DesignImagePicker } from "@/app/design-image-picker"
import { IdentityFillPanel } from "@/app/identity-fill-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { useIdentity } from "@/app/use-identity"
import type { PipelineStep, PluginSummary } from "@/lib/api"
import { MODE_HINT, READ_IMAGE_HINT, modeTakesRoute, type TaskForm } from "@/lib/task-form"

/*
 * 新建任务卡片：填链接 / 工程目录 / Target / 区域 / 路线，走 A 路线时还能先把设计稿位图选上，
 * 然后「加入看板并开始」。只负责渲染与把用户输入交出去，取值链、候选与登记表写入都在 useIdentity；
 * 位图只是先拿着（跟着建出来的任务暂存，尺寸核对与落地在流水线跑到那一步之后，见 lib/design-image.js）。
 */

type Props = {
  form: TaskForm
  onForm: (patch: Partial<TaskForm>) => void
  plugin: PluginSummary | null
  contract: PipelineStep[]
  identity: ReturnType<typeof useIdentity>
  /** 新建时先选好的设计稿位图（还没暂存到磁盘，只是这一份文件）：走 A 路线时才有意义。 */
  image: File | null
  onPickImage: (file: File | null) => void
  busy: string
  failure: string
  canStop: boolean
  onStart: () => void
  onStop: () => void
  onReloadContract: () => void
}

export function NewTaskCard(props: Props) {
  const { form, onForm, plugin, contract, identity, busy, failure, canStop, onStart, onStop, onReloadContract } = props

  return (
    <Card>
      <CardHeader>
        <CardTitle>新建转码任务</CardTitle>
        <CardDescription>
          一次任务只走一条路线；选 AB 会跑两次（先 A 后 B），两条进度独立，互不覆盖。任务会进看板，
          有自己的工作目录，跑完自动合并回工程。
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {plugin && <Badge variant="outline">插件 {plugin.version ? "v" + plugin.version : "未知版本"}</Badge>}
          {plugin && <Badge variant="secondary">共 {contract.length} 步</Badge>}
          {plugin && !plugin.runAllExists && <Badge variant="destructive">缺 run-all.ps1</Badge>}
          <Button variant="outline" size="sm" onClick={onReloadContract}>
            <RefreshCw className="size-4" />
            重读契约
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* 三组各成一个框：必填 / 可自动补齐 / 可选。 */}
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-4">
            <FieldGroup title="必填" hint="不填跑不了">
              <div className="flex flex-col gap-2">
                <Label htmlFor="run-link">MasterGo 链接（页面帧或容器）</Label>
                <Input
                  id="run-link"
                  spellCheck={false}
                  placeholder="https://mastergo.com/goto/xxxx?file=...&layer_id=..."
                  value={form.link}
                  onChange={(event) => onForm({ link: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="run-project">工程目录</Label>
                <Input
                  id="run-project"
                  spellCheck={false}
                  placeholder="绝对路径 —— 产物合并回这里"
                  value={form.projectRoot}
                  onChange={(event) => onForm({ projectRoot: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>路线</Label>
                <Select value={form.mode} onValueChange={(value) => onForm({ mode: value })}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{form.mode}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {/* 每一项的说法与下面那行说明同源（都在 ui/src/lib/task-form.ts 的 MODE_HINT 里）。 */}
                    {(["B", "A", "AB"] as const).map((value) => (
                      <SelectItem key={value} value={value}>
                        {MODE_HINT[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">{MODE_HINT[form.mode] ?? ""}</p>
              </div>
            </FieldGroup>

            <FieldGroup title="可选" hint="不填就走默认">
              <div className="flex flex-col gap-2">
                <Label htmlFor="run-stop">停在某一步</Label>
                <Input
                  id="run-stop"
                  spellCheck={false}
                  placeholder="例如 discover —— 先出待命名清单"
                  value={form.stopAfter}
                  onChange={(event) => onForm({ stopAfter: event.target.value })}
                />
              </div>
              {modeTakesRoute(form.mode, "A") && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="run-image">设计稿位图（可选）</Label>
                  <DesignImagePicker id="run-image" file={props.image} onPick={props.onPickImage} />
                  <p className="text-muted-foreground text-xs">{READ_IMAGE_HINT}</p>
                </div>
              )}
            </FieldGroup>
          </div>

          <div className="flex flex-col gap-4">
            <FieldGroup title="可自动补齐" hint="留空就按工程登记表解析；也可以让它按设计页名补">
              <div className="flex flex-col gap-2">
                <Label htmlFor="run-target">页面 Target</Label>
                <Input
                  id="run-target"
                  spellCheck={false}
                  placeholder="页面名 —— 产物文件名与 UI 区域都按它算"
                  value={form.target}
                  onChange={(event) => onForm({ target: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="run-ui">UI 区域</Label>
                <Input
                  id="run-ui"
                  spellCheck={false}
                  placeholder="F3 —— 登记表没登记时才要填"
                  value={form.ui}
                  onChange={(event) => onForm({ ui: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="run-identity-name">设计页名</Label>
                <Input
                  id="run-identity-name"
                  spellCheck={false}
                  placeholder="设计稿里的中文名，例如 停止调整"
                  value={identity.name}
                  onChange={(event) => identity.setName(event.target.value)}
                />
              </div>

              <IdentityFillPanel
                inputs={identity.inputs}
                state={{
                  candidates: identity.candidates,
                  busy: identity.busy,
                  derivedUi: identity.derivedUi,
                  pages: identity.pages
                }}
                actions={{
                  onFill: () => void identity.fill(),
                  onApply: (item) => void identity.apply(item),
                  onTakePageName: identity.takeDesignPageName,
                  onPick: onForm
                }}
              />
            </FieldGroup>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="run-overwrite"
              checked={form.overwrite}
              onCheckedChange={(checked) => onForm({ overwrite: checked })}
            />
            <Label htmlFor="run-overwrite">替换已有产物（默认不替换，同名就停）</Label>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {canStop && (
              <Button variant="outline" disabled={busy !== ""} onClick={onStop}>
                <Square className="size-4" />
                停止
              </Button>
            )}
            <Button disabled={busy !== ""} onClick={onStart}>
              {busy === "start" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              加入看板并开始
            </Button>
          </div>
        </div>

        {failure && (
          <Alert variant="destructive">
            <AlertTitle>启动失败</AlertTitle>
            <AlertDescription>
              <ClampText text={failure} />
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

/* 一组输入：外面一个框 + 标题行，把「必填 / 可自动补齐 / 可选」在视觉上分开。 */
function FieldGroup(props: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border px-3 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">{props.title}</span>
        <span className="text-muted-foreground text-xs">{props.hint}</span>
      </div>
      {props.children}
    </section>
  )
}
