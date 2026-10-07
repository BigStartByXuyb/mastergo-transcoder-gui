import { slotState, type PluginSourceSlot } from "@/lib/plugin-sources"
import { sourceStatusText } from "@/app/plugin-source-facts"

/*
 * 查找顺序那一行：八档按后端给的次序排成一条，每一档写清处境（正在用 / 可用 / 没有 / 与第 N 档同一份）。
 * 点某一档开的是它并进那一行的详情 —— 表里行号与这里的序号因此对得上。
 */

export function LookupOrder(props: { slots: PluginSourceSlot[]; onOpen: (rowId: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs">
      {props.slots.map((slot, index) => (
        <span key={slot.id} className="flex items-center gap-1">
          {index > 0 && <span className="text-muted-foreground">→</span>}
          <button
            type="button"
            className="hover:bg-accent rounded-md border px-2 py-0.5 text-left"
            title={slot.path}
            onClick={() => props.onOpen(slot.mergedInto || slot.id)}
          >
            <span className="text-muted-foreground">{slot.order}.</span> {slot.label}
            <SlotMark slot={slot} />
          </button>
        </span>
      ))}
    </div>
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
