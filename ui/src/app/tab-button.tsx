import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/*
 * 一组里选一个的按钮：设置左边那一列，和「更新」页里的两段切换，共用这一个。
 * 选中态与 hover 的配色只在这里维护；图标只有设置那一列有。
 *
 * 两处都用「nav + aria-current」这一种写法，不一半 tablist 一半普通按钮 —— 同一屏里两种
 * 无障碍语义会让读屏与用例各说各话（这里不做真正的 tabpanel 关联）。
 */
export function TabButton(props: {
  selected: boolean
  label: string
  hint: string
  icon?: LucideIcon
  onClick: () => void
  /** 外层布局给的（左栏竖排、段切换横向平分）。 */
  className?: string
}) {
  const Icon = props.icon
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-current={props.selected ? "true" : undefined}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors",
        props.selected
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
        props.className
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {Icon ? <Icon className="size-4" /> : null}
        {props.label}
      </span>
      <span className={cn("text-muted-foreground text-xs", Icon ? "pl-6" : "")}>{props.hint}</span>
    </button>
  )
}
