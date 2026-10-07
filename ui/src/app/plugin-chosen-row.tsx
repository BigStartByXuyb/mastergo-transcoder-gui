import { FolderSearch } from "lucide-react"

import { BusyActionButton } from "@/app/update-source-actions"
import { ownsChosenSlot, PLUGIN_BUSY, type PluginSourceRow } from "@/lib/plugin-sources"

/*
 * 「我指定的那一份」这一档在表里那一行上的两处专属渲染 —— 通用行组件不碰它的语义：
 *   没设时，那一行的路径格本来是空的：在那里说清「按这个顺序往下找」。
 *   操作列是它的两个指针动作：指定 / 换一个目录、交给客户端找（清掉）。
 * 「这一行是不是承载这一档」由 ownsChosenSlot（lib/plugin-sources）一处判，这里与行组件都读它。
 */

/** 没设时路径格里那句话；其余情况回空串（路径格照常显示路径）。 */
export function chosenPathNote(row: PluginSourceRow, chosen: string): string {
  if (!ownsChosenSlot(row) || chosen) return ""
  return "没指定：按这个顺序往下找，现在用的是标「正在用」的那一条。"
}

/** 承载这一档的行才有的两个动作；别的行什么都不渲染。 */
export function ChosenActions(props: {
  row: PluginSourceRow
  /** 设置里存的那一份（空串＝按顺序自动）：决定第一颗按钮是「指定」还是「换」。 */
  chosen: string
  /** 来源清单那一半的忙碌位：拿它比 PLUGIN_BUSY 的 pick / auto 才知道是这两颗哪一颗在跑。 */
  busy: string
  frozen: boolean
  onPick: () => void
  onAuto: () => void
}) {
  if (!ownsChosenSlot(props.row)) return null
  return (
    <>
      <BusyActionButton
        label={props.chosen ? "换个目录…" : "指定一个目录…"}
        icon={<FolderSearch className="size-4" />}
        busy={props.busy === PLUGIN_BUSY.pick}
        disabled={props.frozen}
        onClick={props.onPick}
      />
      <BusyActionButton
        label="交给客户端找"
        busy={props.busy === PLUGIN_BUSY.auto}
        disabled={props.frozen || !props.chosen}
        onClick={props.onAuto}
      />
    </>
  )
}
