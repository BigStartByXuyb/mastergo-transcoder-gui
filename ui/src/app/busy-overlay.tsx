import { Loader2 } from "lucide-react"

/*
 * 换版本这种「整机在动、界面不能点」的时刻用的遮罩：铺满窗口，挡住所有操作，
 * 只留一句话和一个转圈。铺满的是整个窗口，不是某一张卡片。
 */
export function BusyOverlay(props: { title: string; note?: string }) {
  return (
    <div
      role="alertdialog"
      aria-busy="true"
      className="bg-background/85 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
        <p className="text-sm font-medium">{props.title}</p>
        {props.note && <p className="text-muted-foreground text-xs">{props.note}</p>}
      </div>
    </div>
  )
}
