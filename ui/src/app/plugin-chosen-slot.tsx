import { FolderSearch, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { IdentifierText } from "@/app/identifier-text"
import { SourceStatusBadge } from "@/app/plugin-source-facts"
import { PLUGIN_BUSY, type PluginSourceSlot } from "@/lib/plugin-sources"

/*
 * 顶部那条「我指定的那一份」：显示这一档的处境与路径，两个动作 —— 指定一个目录… / 交给客户端找。
 * 处境不在这里另判：读 pluginLookup 给的结论（slot），徽章与表、面板读同一个组件（SourceStatusBadge），
 * 与表里那一行、顺序条上那一档说的是同一句话。
 */

export function ChosenSlot(props: {
  /** 设置里存的那一份（空串＝按顺序自动）。 */
  chosen: string
  /** 查找顺序里这一档（没设时也有：path 为空串、exists 为假）。 */
  slot: PluginSourceSlot | null
  /** 来源清单那一半的忙碌位：只有拿它比 PLUGIN_BUSY 的 pick / auto 才是这两个按钮自己的动作在跑。 */
  busy: string
  /** 任一半在跑：忙的时候不给换一份。 */
  frozen: boolean
  onPick: () => void
  onAuto: () => void
}) {
  const active = Boolean(props.slot && props.slot.active)
  const exists = Boolean(props.slot && props.slot.exists)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
      <span className="text-sm font-medium">我指定的那一份</span>
      {props.chosen ? (
        <>
          <SourceStatusBadge active={active} exists={exists} />
          <IdentifierText className="text-muted-foreground min-w-0 flex-1 text-xs" text={props.chosen} />
        </>
      ) : (
        <span className="text-muted-foreground min-w-0 flex-1 text-xs">
          没指定：客户端按下面的顺序自己找，现在用的是标「正在用」的那一条。
        </span>
      )}
      <Button size="sm" variant="outline" disabled={props.frozen} aria-busy={props.busy === PLUGIN_BUSY.pick} onClick={props.onPick}>
        {props.busy === PLUGIN_BUSY.pick ? <Loader2 className="size-4 animate-spin" /> : <FolderSearch className="size-4" />}
        指定一个目录…
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={props.frozen || !props.chosen}
        aria-busy={props.busy === PLUGIN_BUSY.auto}
        onClick={props.onAuto}
      >
        {props.busy === PLUGIN_BUSY.auto && <Loader2 className="size-4 animate-spin" />}
        交给客户端找
      </Button>
    </div>
  )
}
