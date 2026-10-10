import { Loader2, Sparkles } from "lucide-react"

import type { useIdentityFill } from "@/app/use-identity-fill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DesignImagePicker } from "@/app/design-image-picker"
import { ModeField } from "@/app/mode-field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { BoardTaskForm } from "@/lib/board-form"
import { parseBoardRows } from "@/lib/board-items"
import { AUTOMATION_LABEL, READ_IMAGE_HINT, modeTakesRoute } from "@/lib/task-form"

/* 行上只给能认出是哪一页的那一段：链接太长，整条铺出来会把这一行挤成一团。 */
function linkLabel(link: string): string {
  const match = /[?&]layer_id=([^&]+)/.exec(link)
  return match ? match[1] : link
}

/*
 * 创建任务：工程、模式、链接这些只在要加任务时才需要，收进弹窗，
 * 看板一进来看到的就是任务本身。
 * Target 与区域能按链接补齐（与新建任务卡片同一套实现），补完直接写进上面的链接行。
 * 走 A 路线时每一行（一个页面）各选一张设计稿位图：一行一个任务，图跟着那一行那条任务走。
 */
export function BoardNewTaskDialog(props: {
  open: boolean
  form: BoardTaskForm
  /** 按链接记的位图：一行一份（同一链接就是同一页）。 */
  images: Record<string, File>
  busy: boolean
  automation: string
  identity: ReturnType<typeof useIdentityFill>
  identityFailure: string
  onChange: (form: BoardTaskForm) => void
  onPickImage: (link: string, file: File | null) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  onFill: () => void
}) {
  const form = props.form
  const identity = props.identity
  const rows = parseBoardRows(form.links, form.mode)

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>创建任务</DialogTitle>
          <DialogDescription>
            一行一个链接；要指定页面名就写 链接 | Target。没写的可以点下面的「按链接补 Target / 区域」。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="board-project">工程目录</Label>
            <Input
              id="board-project"
              spellCheck={false}
              placeholder="工程根目录的绝对路径"
              value={form.projectRoot}
              onChange={(event) => props.onChange({ ...form, projectRoot: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="board-ui">Ui 前缀</Label>
            <Input
              id="board-ui"
              spellCheck={false}
              placeholder="例如 F1；Target 推不出来时必填"
              value={form.ui}
              onChange={(event) => props.onChange({ ...form, ui: event.target.value })}
            />
          </div>
          <ModeField
            label="默认模式"
            value={form.mode}
            onChange={(mode) => props.onChange({ ...form, mode: mode as BoardTaskForm["mode"] })}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="board-stop">停在某一步（可选）</Label>
            <Input
              id="board-stop"
              spellCheck={false}
              placeholder="例如 discover —— 先出待命名清单"
              value={form.stopAfter}
              onChange={(event) => props.onChange({ ...form, stopAfter: event.target.value })}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
            <div className="leading-tight">
              <div className="text-sm">跑完自动合并</div>
              <div className="text-muted-foreground text-xs">冲突时停下等人。</div>
            </div>
            <Switch
              checked={form.autoMerge}
              onCheckedChange={(value) => props.onChange({ ...form, autoMerge: value })}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
            <div className="leading-tight">
              <div className="text-sm">替换已有产物</div>
              <div className="text-muted-foreground text-xs">工程里已有同名页面时覆盖它。</div>
            </div>
            <Switch
              checked={form.overwrite}
              onCheckedChange={(value) => props.onChange({ ...form, overwrite: value })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="board-links">MasterGo 链接</Label>
          <Textarea
            id="board-links"
            rows={6}
            spellCheck={false}
            placeholder={"https://mastergo.com/goto/xxxx?file=…&layer_id=…\nhttps://mastergo.com/goto/yyyy?file=…&layer_id=… | F3Align"}
            value={form.links}
            onChange={(event) => props.onChange({ ...form, links: event.target.value })}
          />
        </div>

        {/* 一行一个页面：走 A 路线时每行各配一张设计稿位图（一个任务一份，见 ui/src/app/stage-design-images.ts）。 */}
        {modeTakesRoute(form.mode, "A") && (
          <div className="flex flex-col gap-2">
            {/* 这一组下面是每行一个文件框，没有单个可关联的控件，所以不当 Label 用。 */}
            <div className="text-sm font-medium">设计稿位图（可选）</div>
            <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
              {rows.length === 0 && (
                <span className="text-muted-foreground text-xs">先在上面写链接：一行一个页面，一行配一张图。</span>
              )}
              {rows.map((row) => (
                <div key={row.line} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-xs">第 {row.line} 行</span>
                  {/* 这一行的链接就是它自己那个选图框的标签（一行一个页面）。 */}
                  <Label
                    htmlFor={"board-image-" + row.line}
                    className="text-muted-foreground max-w-40 min-w-0 truncate font-mono text-xs font-normal"
                    title={row.link}
                  >
                    {linkLabel(row.link)}
                  </Label>
                  {row.target && <Badge variant="secondary">{row.target}</Badge>}
                  <DesignImagePicker
                    id={"board-image-" + row.line}
                    file={props.images[row.link] ?? null}
                    onPick={(file) => props.onPickImage(row.link, file)}
                  />
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">{READ_IMAGE_HINT}</p>
          </div>
        )}

        {/* 补 Target / 区域：按每一行取设计页名与候选，写进工程登记表后回填到链接行。 */}
        <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={identity.busy !== ""} onClick={props.onFill}>
              {identity.busy === "fill" ? <Loader2 className="animate-spin" /> : <Sparkles />}
              按链接补 Target / 区域
            </Button>
            <span className="text-muted-foreground text-xs">
              按链接取设计页名，再按工程既有区域约定给候选；能定的写进工程登记表并填回这一行。
              当前自动化层级：{AUTOMATION_LABEL[props.automation] ?? props.automation}
            </span>
          </div>
          {identity.rows.map((row) => (
            <div key={row.link} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground max-w-56 min-w-0 truncate font-mono" title={row.link}>
                {linkLabel(row.link)}
              </span>
              {row.kind === "filled" && (
                <>
                  <Badge variant="secondary">
                    {row.target}
                    {row.ui ? " · UI " + row.ui : ""}
                  </Badge>
                  <span className="text-muted-foreground">{row.basis}</span>
                </>
              )}
              {row.kind === "pick" && (
                <>
                  {row.items
                    .filter((item) => item.target)
                    .map((item) => (
                      <Button
                        key={item.target + item.ui}
                        size="sm"
                        variant={item.needsSemanticName ? "outline" : "default"}
                        disabled={item.needsSemanticName || identity.busy !== ""}
                        onClick={() => void identity.take(row, item)}
                      >
                        {item.needsSemanticName ? "还缺语义名" : item.target + (item.ui ? " · " + item.ui : "")}
                      </Button>
                    ))}
                  {row.reason && <span className="text-amber-600">{row.reason}</span>}
                </>
              )}
              {row.kind === "none" && <span className="text-amber-600">{row.reason}</span>}
            </div>
          ))}
          {props.identityFailure && <p className="text-destructive text-xs">{props.identityFailure}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={props.busy} onClick={props.onSubmit}>
            {props.busy ? <Loader2 className="animate-spin" /> : null}
            加入看板
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
