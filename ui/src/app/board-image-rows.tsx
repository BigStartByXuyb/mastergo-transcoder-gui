import { DesignImagePicker } from "@/app/design-image-picker"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { linkLabel, pickedForLink, type BoardRow } from "@/lib/board-items"
import { DESIGN_IMAGE_LABEL, READ_IMAGE_HINT } from "@/lib/task-form"

/*
 * 创建任务弹窗「可选」组里的设计稿位图：一行（一个页面）一个框。
 * 选哪一张由调用方按链接记（ui/src/lib/board-items.ts），暂存与尺寸核对在任务建出来之后
 * （ui/src/app/stage-design-images.ts）。
 */
export function BoardImageRows(props: {
  rows: BoardRow[]
  images: Record<string, File>
  onPickImage: (link: string, file: File | null) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* 这一组下面是每行一个文件框，没有单个可关联的控件，所以不当 Label 用。 */}
      <div className="text-sm font-medium">{DESIGN_IMAGE_LABEL}</div>
      <div className="flex flex-col gap-2 rounded-md border px-3 py-2">
        {props.rows.length === 0 && (
          <span className="text-muted-foreground text-xs">先在上面写链接：一行一个页面，一行配一张图。</span>
        )}
        {props.rows.map((row) => (
          <div key={row.line} className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs">第 {row.line} 行</span>
            {/* 这一行的链接就是它自己那个选图框的标签（一行一个页面）。 */}
            <Label
              htmlFor={"board-image-" + row.line}
              className="text-muted-foreground max-w-40 min-w-0 truncate font-mono text-xs font-normal"
              title={row.link}
            >
              {linkLabel(row.link)}
            </Label>
            {row.target && <Badge variant="secondary">{row.target}</Badge>}
            <DesignImagePicker
              id={"board-image-" + row.line}
              file={pickedForLink(props.images, row.link)}
              onPick={(file) => props.onPickImage(row.link, file)}
            />
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{READ_IMAGE_HINT}</p>
    </div>
  )
}
