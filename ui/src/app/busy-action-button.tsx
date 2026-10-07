import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"

/*
 * 忙碌态动作按钮的壳：文字、图标、转圈、禁用与 aria-busy 只有这一套写法。
 * 图标由调用方给（忙时换成转圈）；「忙不忙」与「能不能点」由调用方按各自那条线的判据算好传进来。
 * 与某一条业务线无关，所以单独一个模块 —— 各处的具体动作按钮（用这份 / 检查更新 / 下载并安装 / 换目录…）
 * 都基于它包装。
 */

export function BusyActionButton(props: {
  label: string
  /** 不忙时显示的图标；不给就只显示文字。 */
  icon?: ReactNode
  busy: boolean
  disabled: boolean
  /** 描边（表里那几处）或实心（主要的那个动作，如「下载并安装」）。 */
  variant?: "outline" | "default"
  /** 默认小号（表里那几处）；程序更新卡片上是默认号。 */
  size?: "sm" | "default"
  onClick: () => void
}) {
  return (
    <Button
      size={props.size ?? "sm"}
      variant={props.variant ?? "outline"}
      disabled={props.disabled}
      aria-busy={props.busy}
      onClick={props.onClick}
    >
      {props.busy ? <Loader2 className="size-4 animate-spin" /> : props.icon}
      {props.label}
    </Button>
  )
}
