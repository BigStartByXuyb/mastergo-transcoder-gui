import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

/*
 * 「只看生效」：同一页面只留当前生效那一行，被后一次合并覆盖的藏起来。
 *
 * 看板与区域详情共用一处 —— 两边各写一份开关，文案、默认值、藏起几条的口径迟早分叉。
 * 藏了几条由调用方数好传进来；这里不碰任务数据，只负责开关本身。
 */

type Props = {
  id: string
  checked: boolean
  hidden: number
  onChange: (value: boolean) => void
}

export function EffectiveToggle(props: Props) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onChange} />
      <Label htmlFor={props.id} className="text-xs">
        只看生效{props.hidden > 0 ? `（已藏起 ${props.hidden} 条被覆盖的）` : ""}
      </Label>
    </div>
  )
}
