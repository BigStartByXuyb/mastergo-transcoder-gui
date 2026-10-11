import { Loader2 } from "lucide-react"

import { BoardIdentityFill } from "@/app/board-identity-fill"
import { BoardImageRows } from "@/app/board-image-rows"
import type { useIdentityFill } from "@/app/use-identity-fill"
import { Button } from "@/components/ui/button"
import { FIELD_GROUPS, FieldGroup } from "@/app/field-group"
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
import { modeTakesRoute } from "@/lib/task-form"

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

        {/* 三组的标题与提示语与新建任务那张表单同源（ui/src/app/field-group.tsx 的 FIELD_GROUPS）。 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldGroup {...FIELD_GROUPS.required}>
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
              <Label htmlFor="board-links">MasterGo 链接</Label>
              <Textarea
                id="board-links"
                rows={5}
                spellCheck={false}
                placeholder={"https://mastergo.com/goto/xxxx?file=…&layer_id=…\nhttps://mastergo.com/goto/yyyy?file=…&layer_id=… | F3Align"}
                value={form.links}
                onChange={(event) => props.onChange({ ...form, links: event.target.value })}
              />
            </div>
            <ModeField
              label="默认模式"
              value={form.mode}
              onChange={(mode) => props.onChange({ ...form, mode: mode as BoardTaskForm["mode"] })}
            />
          </FieldGroup>

          <FieldGroup {...FIELD_GROUPS.autofill}>
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
            <BoardIdentityFill
              rows={identity.rows}
              busy={identity.busy}
              automation={props.automation}
              failure={props.identityFailure}
              onFill={props.onFill}
              onTake={(row, item) => void identity.take(row, item)}
            />
          </FieldGroup>
        </div>

        <FieldGroup {...FIELD_GROUPS.optional}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="board-stop">停在某一步</Label>
            <Input
              id="board-stop"
              spellCheck={false}
              placeholder="例如 discover —— 先出待命名清单"
              value={form.stopAfter}
              onChange={(event) => props.onChange({ ...form, stopAfter: event.target.value })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
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

          {/* 一行一个页面：走 A 路线时每行各配一张设计稿位图（一个任务一份）。 */}
          {modeTakesRoute(form.mode, "A") && (
            <BoardImageRows rows={rows} images={props.images} onPickImage={props.onPickImage} />
          )}
        </FieldGroup>

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
