import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { BoardTaskForm } from "@/lib/board-form"

/*
 * 创建任务：工程、模式、链接这些只在要加任务时才需要，收进弹窗，
 * 看板一进来看到的就是任务本身。
 */
export function BoardNewTaskDialog(props: {
  open: boolean
  form: BoardTaskForm
  busy: boolean
  onChange: (form: BoardTaskForm) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}) {
  const form = props.form

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>创建任务</DialogTitle>
          <DialogDescription>一行一个链接；要指定页面名就写 链接 | Target。</DialogDescription>
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
          <div className="flex flex-col gap-2">
            <Label>默认模式</Label>
            <Select
              value={form.mode}
              onValueChange={(value) => props.onChange({ ...form, mode: value as BoardTaskForm["mode"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="B">B —— MTSLG IOContorl</SelectItem>
                <SelectItem value="A">A —— MW WPF</SelectItem>
                <SelectItem value="AB">AB —— 两条都跑</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
