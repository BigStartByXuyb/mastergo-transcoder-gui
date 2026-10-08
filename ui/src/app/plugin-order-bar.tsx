import { slotState, type PluginSourceSlot } from "@/lib/plugin-sources"
import { sourceStatusText, sourceTone } from "@/app/plugin-source-facts"
import { cn } from "@/lib/utils"

/*
 * 查找顺序这一块：八档按后端给的次序排成一条，每一档写清处境（正在用 / 可用 / 没有 / 与第 N 档同一份），
 * 并按处境给亮/灰（正在用＝亮，有但没用＝中灰，没有＝更淡）。点某一档开的是它并进那一行的详情 ——
 * 表里行号与这里的序号因此对得上。
 */

export function LookupOrder(props: { slots: PluginSourceSlot[]; onOpen: (rowId: string) => void }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">查找顺序</span>
        <span className="text-muted-foreground text-xs">
          客户端按这个次序找插件：正在用的那一档是亮的；点某一档看它的详情。
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
        {props.slots.map((slot, index) => (
          <span key={slot.id} className="flex items-center gap-1">
            {index > 0 && <span className="text-muted-foreground">→</span>}
            <button
              type="button"
              className={cn(
                "hover:bg-accent rounded-md border px-2 py-0.5 text-left",
                sourceTone(slot.active, slot.exists)
              )}
              title={slot.path}
              onClick={() => props.onOpen(slot.mergedInto || slot.id)}
            >
              <span className="opacity-70">{slot.order}.</span> {slot.label}
              <SlotMark slot={slot} />
            </button>
          </span>
        ))}
      </div>
    </section>
  )
}

// 一档的处境：前三样（正在用 / 可用 / 没有）的措辞与表、面板的徽章读同一处（sourceStatusText）。
function SlotMark(props: { slot: PluginSourceSlot }) {
  const state = slotState(props.slot)
  if (state === "same") {
    return <span className="text-muted-foreground">{`（与第 ${props.slot.mergedIntoOrder} 档同一份）`}</span>
  }
  if (state === "active") return <span className="font-medium">{`（${sourceStatusText(true, true)}）`}</span>
  return <span className="text-muted-foreground">{`（${sourceStatusText(false, state === "available")}）`}</span>
}
