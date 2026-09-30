import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"

/*
 * 允许它改工程文件：勾一次确认，改的范围就是这条对话绑的那份工程目录。
 * 确认后顶上只留一个标注，不再常驻在输入区里挤地方。
 */

export function ChatWriteDialog(props: {
  open: boolean
  projectRoot: string
  /** 设置里的写盘总开关：关着时这里只说明原因，不给勾。 */
  enabled: boolean
  confirmed: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onRevoke: () => void
}) {
  const [checked, setChecked] = useState(false)
  const target = props.projectRoot.trim()

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>允许它改工程文件</DialogTitle>
          <DialogDescription>写盘只落在这一份工程目录之内，别处一律不动。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="rounded-md border px-3 py-2 text-xs">
            <div className="text-muted-foreground">会改动的位置</div>
            <div className="font-mono break-all">{target || "这条对话还没绑工程目录，改不了文件。"}</div>
          </div>
          {!props.enabled && (
            <p className="text-amber-600 text-xs">写盘总开关在「设置 → AI Agent」里关着，先把它打开才能确认。</p>
          )}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={checked}
              disabled={!target || !props.enabled}
              onCheckedChange={(value) => setChecked(value === true)}
            />
            我确认：只让它改这个工程目录里的文件
          </label>
          {props.confirmed && <p className="text-muted-foreground text-xs">这条对话现在是「可改工程文件」，改成只读随时可以退回去。</p>}
        </div>

        <DialogFooter>
          {props.confirmed && (
            <Button variant="outline" onClick={props.onRevoke}>
              改成只读
            </Button>
          )}
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!checked || !target || !props.enabled} onClick={props.onConfirm}>
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
