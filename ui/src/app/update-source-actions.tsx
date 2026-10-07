import { Loader2, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"

/*
 * 发布源 / 插件来源这一带共用的两个动作按钮：「用这份」（插件页各处）与「检查更新」
 * （插件页与程序更新那一半都用）。两页共用同一个模块，所以名字按这一件事（发布源那一带）取，
 * 不按某一张页面取。
 *
 * 为什么单开一处：同一颗按钮会出现在好几处（「用这份」在来源表那一行与行内面板；
 * 「检查更新」在插件页自带那一行的管理面板与程序更新那张卡里），文字、图标、转圈与禁用必须同形 ——
 * 「忙不忙」与「能不能点」由调用方按各自那条线的判据算好（busy / disabled 两个布尔），这里只负责长什么样。
 */

export function ChooseSourceButton(props: { busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" disabled={props.disabled} aria-busy={props.busy} onClick={props.onClick}>
      {props.busy && <Loader2 className="size-4 animate-spin" />}
      用这份
    </Button>
  )
}

export function CheckUpdateButton(props: {
  busy: boolean
  disabled: boolean
  /** 默认小号（插件页那几处）；程序更新卡片上是默认号。 */
  size?: "sm" | "default"
  onClick: () => void
}) {
  return (
    <Button
      size={props.size ?? "sm"}
      variant="outline"
      disabled={props.disabled}
      aria-busy={props.busy}
      onClick={props.onClick}
    >
      {props.busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      检查更新
    </Button>
  )
}
