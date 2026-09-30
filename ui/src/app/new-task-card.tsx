import { Loader2, Play, RefreshCw, Sparkles, Square } from "lucide-react"
import type { ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ClampText } from "@/app/clamp-text"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { useIdentity } from "@/app/use-identity"
import type { PipelineStep, PluginSummary } from "@/lib/api"
import { AUTOMATION_LABEL, MODE_HINT, adoptsIdentityWithoutConfirm, type TaskForm } from "@/lib/task-form"

/*
 * 新建任务卡片：填链接 / 工程目录 / Target / 区域 / 路线，然后「加入看板并开始」。
 * 只负责渲染与把用户输入交出去，取值链、候选与登记表写入都在 useIdentity。
 */

type Props = {
  form: TaskForm
  onForm: (patch: Partial<TaskForm>) => void
  plugin: PluginSummary | null
  contract: PipelineStep[]
  automation: string
  identity: ReturnType<typeof useIdentity>
  busy: string
  failure: string
  canStop: boolean
  onStart: () => void
  onStop: () => void
  onReloadContract: () => void
}

export function NewTaskCard(props: Props) {
  const { form, onForm, plugin, contract, automation, identity, busy, failure } = props
  const needsIdentityHint = !form.ui.trim() && !form.target.trim()
  // 填了 Target 但仍推不出区域：这是最容易被误判成「插件坏了」的情况，必须提前说清原因。
  const targetWithoutPrefix = !form.ui.trim() && Boolean(form.target.trim()) && !identity.derivedUi

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
          <Button variant="outline" size="sm" onClick={props.onReloadContract}>
            <RefreshCw className="size-4" />
            重读契约
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* 三组各成一个框：必填 / 可自动补齐 / 可选。 */}
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Group title="必填" hint="不填跑不了">
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
                    <SelectItem value="B">B —— MTSLG IOContorl 页面 XML</SelectItem>
                    <SelectItem value="A">A —— MW WPF XAML 页面</SelectItem>
                    <SelectItem value="AB">AB —— 两条都跑</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">{MODE_HINT[form.mode] ?? ""}</p>
              </div>
            </Group>

            <Group title="可选" hint="不填就走默认">
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
            </Group>
          </div>

          <Group title="可自动补齐" hint="留空就按工程登记表解析；也可以让它按设计页名补">
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

            <div className="text-muted-foreground flex flex-col gap-1 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={identity.busy !== ""} onClick={() => void identity.fill()}>
                  {identity.busy === "candidates" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  自动补 Target / 区域
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={identity.busy !== "" || !form.link.trim()}
                  onClick={() => identity.takeDesignPageName()}
                >
                  {identity.busy === "name" ? <Loader2 className="size-4 animate-spin" /> : null}
                  从链接取设计页名
                </Button>
                <span>
                  按项目既有区域约定 + 设计页名给出候选并写进工程登记表；当前自动化层级：
                  {AUTOMATION_LABEL[automation] ?? automation}
                  {adoptsIdentityWithoutConfirm(automation)
                    ? "（这一页登记过就自动沿用；没登记过由模型按设计页名给名直接采用，给不出才停下来要你点一次）"
                    : "（列出来，你点一下再写）"}
                </span>
              </div>
              {identity.candidates.length > 0 && (
            <div className="flex flex-col gap-1">
              {identity.candidates.map((item, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={item.needsSemanticName ? "outline" : "default"}
                    disabled={!item.target || item.needsSemanticName || identity.busy !== ""}
                    onClick={() => void identity.apply(item)}
                  >
                    {item.needsSemanticName ? "还缺语义名" : item.target}
                  </Button>
                  <span>
                    {item.ui ? "UI " + item.ui + " · " : ""}
                    {item.basis}
                    {typeof item.confidence === "number" ? " · 置信度 " + item.confidence : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
              {identity.derivedUi && (
                <span>将使用 UI={identity.derivedUi}（按 Target 前缀推导；插件自己也会这么算）</span>
              )}
              {needsIdentityHint && (
                <span className="text-amber-600">
                  UI 与 Target 都空：插件会按取值链解析（登记表 → Target 前缀/首词）；都取不到就会在入口停下。
                  最省事的做法是把 Target 写成带区域前缀的形式，例如 F3Align。
                </span>
              )}
              {targetWithoutPrefix && (
                <span className="text-amber-600">
                  Target「{form.target.trim()}」推不出区域前缀：插件只认两种形状——带编号前缀（F3Align → F3）或
                  大写开头的首词（HomeContent → Home）。当前这个写成小写/下划线，两条都不命中。
                  要么把 UI 区域显式填上，要么把 Target 改成 F3{form.target.trim()}（或用 PascalCase 如 TestMastergp）。
                </span>
              )}
              {identity.pages && !identity.pages.exists && <span>{identity.pages.problem}</span>}
              {identity.pages && identity.pages.exists && identity.pages.pages.length === 0 && (
                <span>登记表里还没有可用的页面条目。</span>
              )}
              {identity.pages && identity.pages.exists && identity.pages.pages.length > 0 && (
            <div className="flex flex-col gap-1">
              {/* 按 UI 区域分组：同一区域下的页面放在一起，点一下就切到那个区域的流程。 */}
              <span>
                登记表里登记的页面（按 UI 分组；点一下填上 Target，条目里写了 Ui 就连 Ui 一起填）
                {form.ui.trim() ? "　当前：UI " + form.ui.trim() : ""}
                {form.target.trim() ? " · " + form.target.trim() : ""}
              </span>
              {[...new Set(identity.pages.pages.map((page) => page.ui || "（未写 Ui）"))].sort().map((group) => (
                <div key={group} className="flex flex-wrap items-center gap-2">
                  <Badge variant={form.ui.trim() === group ? "default" : "outline"}>{group}</Badge>
                  {identity.pages?.pages
                    .filter((page) => (page.ui || "（未写 Ui）") === group)
                    .map((page, index) => (
                      <Button
                        key={page.target + index}
                        type="button"
                        size="sm"
                        variant="outline"
                        // 条目里没写 Ui 时照实留空：区域由插件按 Target 前缀自己推。
                        onClick={() => onForm(page.target ? { target: page.target, ui: page.ui } : { ui: page.ui })}
                      >
                        {page.target || page.layerId}
                      </Button>
                    ))}
                </div>
              ))}
            </div>
          )}
            </div>
          </Group>
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
            {props.canStop && (
              <Button variant="outline" disabled={busy !== ""} onClick={props.onStop}>
                <Square className="size-4" />
                停止
              </Button>
            )}
            <Button disabled={busy !== ""} onClick={props.onStart}>
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
function Group(props: { title: string; hint: string; children: ReactNode }) {
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
