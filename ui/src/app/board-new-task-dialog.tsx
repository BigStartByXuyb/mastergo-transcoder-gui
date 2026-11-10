import { Loader2 } from "lucide-react"

import { BoardIdentityFill } from "@/app/board-identity-fill"
import { BoardImageRows } from "@/app/board-image-rows"
import type { useIdentityFill } from "@/app/use-identity-fill"
import { Button } from "@/components/ui/button"
import { FIELD_GROUPS, FieldGroup } from "@/app/field-group"
import { ModeField } from "@/app/mode-field"
import { SWITCH_ROWS, SwitchRow } from "@/app/switch-row"
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
import { Textarea } from "@/components/ui/textarea"
import type { BoardTaskForm } from "@/lib/board-form"
import { parseBoardRows } from "@/lib/board-items"
import { modeTakesRoute, startActionLabel } from "@/lib/task-form"

/*
 * 创建任务：工程、模式、链接这些只在要加任务时才需要，收进弹窗，
 * 看板一进来看到的就是任务本身。
 * Target 与区域能按链接补齐（与新建任务卡片同一套实现），补完直接写进上面的链接行。
 * 走 A 路线时每一行（一个页面）各选一张页面 PNG：一行一个任务，图跟着那一行那条任务走。
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
  const pipelineA = form.mode === "A"
  const usesA = modeTakesRoute(form.mode, "A")

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>创建任务</DialogTitle>
          <DialogDescription>
            {pipelineA
              ? "流水线 A：一行一个 MasterGo 页面链接，并为每行选择按画板原始尺寸导出的 PNG。"
              : "一行一个链接；要指定页面名就写 链接 | Target。没写的可以点下面的「按链接补 Target / 区域」。"}
          </DialogDescription>
        </DialogHeader>

        {/* 三组的标题与提示语与新建任务那张表单同源（ui/src/app/field-group.tsx 的 FIELD_GROUPS）。 */}
        <div className={pipelineA ? "grid items-start gap-4" : "grid items-start gap-4 sm:grid-cols-2"}>
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
                placeholder={pipelineA
                  ? "https://mastergo.com/goto/xxxx?file=…&layer_id=…\nhttps://mastergo.com/goto/yyyy?file=…&layer_id=…"
                  : "https://mastergo.com/goto/xxxx?file=…&layer_id=…\nhttps://mastergo.com/goto/yyyy?file=…&layer_id=… | F3Align"}
                value={form.links}
                onChange={(event) => props.onChange({ ...form, links: event.target.value })}
              />
            </div>
            <ModeField
              label="默认模式"
              value={form.mode}
              onChange={(mode) => props.onChange({ ...form, mode: mode as BoardTaskForm["mode"] })}
            />
            {/* 一行一个页面：走 A 路线时每行各配一张页面 PNG（一个任务一份）。 */}
            {usesA && (
              <BoardImageRows rows={rows} images={props.images} onPickImage={props.onPickImage} />
            )}
          </FieldGroup>

          {!pipelineA && (
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
          )}
        </div>

        <FieldGroup {...FIELD_GROUPS.optional}>
          {!pipelineA && (
            <>
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
                {/* 排法与说法与新建任务那张表单同源（ui/src/app/switch-row.tsx）。 */}
                <SwitchRow
                  id="board-auto-merge"
                  {...SWITCH_ROWS.autoMerge}
                  checked={form.autoMerge}
                  onChange={(value) => props.onChange({ ...form, autoMerge: value })}
                />
                <SwitchRow
                  id="board-overwrite"
                  {...SWITCH_ROWS.overwrite}
                  checked={form.overwrite}
                  onChange={(value) => props.onChange({ ...form, overwrite: value })}
                />
              </div>
            </>
          )}

        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={props.busy} onClick={props.onSubmit}>
            {props.busy ? <Loader2 className="animate-spin" /> : null}
            {startActionLabel(form.mode)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
