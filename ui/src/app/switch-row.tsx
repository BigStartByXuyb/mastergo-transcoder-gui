import { Switch } from "@/components/ui/switch"

/*
 * 一条带说明的开关行（左边「名字 + 一句话」，右边开关）：两张建任务表单共用这一份 ——
 * 排法与两个开关的说法都只有这一处（新建任务那张表单与看板的创建任务弹窗说的是同一句话）。
 */

export const SWITCH_ROWS = {
  autoMerge: { label: "跑完自动合并", hint: "冲突时停下等人。" },
  overwrite: { label: "替换已有产物", hint: "工程里已有同名页面时覆盖它；默认不替换，同名就停。" }
} as const

export function SwitchRow(props: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
      <div className="leading-tight">
        <div className="text-sm">{props.label}</div>
        <div className="text-muted-foreground text-xs">{props.hint}</div>
      </div>
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onChange} />
    </div>
  )
}
