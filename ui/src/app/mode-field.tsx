import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MODE_HINT } from "@/lib/task-form"

/*
 * 路线这一项：下拉 + 说明。三条路线与它们的说法只有 lib/task-form.ts 的 MODE_HINT 那一处，
 * 这里的清单与排法也只有这一份 —— 新建任务卡片与看板的创建任务弹窗共用。
 *
 * 触发按钮只显示短值（A / B / AB），整句放下面一行：否则按钮宽度会随选中项变化，
 * 弹层每次重新定位，看起来像「选一下就跳位置」。
 */

const MODES = ["B", "A", "AB"] as const

export function ModeField(props: {
  /** 这一项在各自表单里叫什么：新建卡片叫「路线」，看板弹窗叫「默认模式」。 */
  label: string
  value: string
  onChange: (mode: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{props.label}</Label>
      <Select value={props.value} onValueChange={props.onChange}>
        <SelectTrigger className="w-full">
          <SelectValue>{props.value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {MODES.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {MODE_HINT[mode]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">{MODE_HINT[props.value] ?? ""}</p>
    </div>
  )
}
