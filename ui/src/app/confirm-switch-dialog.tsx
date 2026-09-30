import { AlertTriangle } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

/*
 * 换版本前确认：把「回退到旧版意味着什么」「这一版要不要新开一次运行」「现在有没有任务在跑」
 * 摆在按钮前面说清楚，再让人点「切过去」。切换本身是即时的，界面会自己回来。
 */

export function ConfirmSwitchDialog(props: {
  /** 要切到的版本。 */
  target: string
  /** 现在跑的版本。 */
  current: string
  /** 目标那一版要不要新开一次运行；不知道就说 null，这一条不显示。 */
  freshRunRequired: boolean | null
  /** 有任务在跑时的一句话（空串表示没在跑）。 */
  busy: string
  /** 回退之后会缺掉的能力（当前有、目标没有的那几样）。 */
  missing: string[]
  onCancel: () => void
  onConfirm: () => void
}) {
  const downgrade = isOlder(props.target, props.current)
  const notes: string[] = []
  if (downgrade) notes.push("这是回退到旧版；要再用新版，得把它重新下回来。")
  if (props.freshRunRequired === true) {
    notes.push("这一版要求新开一次运行：跨版本的续跑不认，正在跑的任务要先跑完。")
  }
  if (props.busy) {
    notes.push("现在有任务在跑（" + props.busy + "），跑完才能换版本。")
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>切到 v{props.target}？</DialogTitle>
          <DialogDescription>
            {downgrade ? "回退" : "升级"}：v{props.current} → v{props.target}。切换时界面会短暂断开，随后自己回来。
          </DialogDescription>
        </DialogHeader>

        {notes.length > 0 && (
          <ul className="flex flex-col gap-2 text-sm">
            {notes.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <AlertTriangle className="text-amber-600 mt-0.5 size-4 shrink-0" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}

        {/* 回退要说清缺了什么：来源是每个版本自己记的「从这一版起具备的能力」。 */}
        {props.missing.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
            <span className="text-sm font-medium">回退之后没有的能力</span>
            <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-xs">
              {props.missing.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={props.onCancel}>
            取消
          </Button>
          <Button disabled={Boolean(props.busy)} onClick={props.onConfirm}>
            切过去
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* 版本号只按数字段比：段数不齐时短的补 0。 */
function isOlder(candidate: string, current: string): boolean {
  const left = candidate.split(".")
  const right = current.split(".")
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const x = Number(left[index] ?? 0)
    const y = Number(right[index] ?? 0)
    if (x !== y) return x < y
  }
  return false
}
