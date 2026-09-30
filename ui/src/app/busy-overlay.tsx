import { PixelLoader } from "@/app/pixel-loader"

/*
 * 「整机在动、界面不能点」的时刻（换版本、重启客户端）用的遮罩：铺满窗口、挡住所有操作。
 * 里面就是那只像素小狐狸在指文字，不转圈。
 */
export function BusyOverlay(props: { text: string; note?: string }) {
  return (
    <div
      role="alertdialog"
      aria-busy="true"
      className="bg-background/85 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3">
        <PixelLoader text={props.text} cell={4} />
        {props.note && <p className="text-muted-foreground text-xs">{props.note}</p>}
      </div>
    </div>
  )
}
