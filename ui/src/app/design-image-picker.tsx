import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useFilePick } from "@/app/use-file-pick"
import { humanSize } from "@/lib/upload-files"

/*
 * 设计稿位图的选图框：新建任务那一张表单与看板的创建任务弹窗共用这一份。
 *
 * 只管「手里拿着哪张图」—— 暂存、尺寸核对、格式判据都在后端（ui/src/lib/stage-design-images.ts
 * 送过去、lib/design-image.js 判）。所以在任务建出来之前这里选什么都不拦。
 */
export function DesignImagePicker(props: {
  id: string
  file: File | null
  onPick: (file: File | null) => void
}) {
  const picked = useFilePick(props.onPick)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={picked.input}
        id={props.id}
        type="file"
        accept="image/png,image/jpeg"
        className="text-xs"
        onChange={picked.onChange}
      />
      {props.file && (
        <>
          <span className="text-muted-foreground text-xs">
            {props.file.name}（{humanSize(props.file.size)}）
          </span>
          <Button size="sm" variant="ghost" onClick={() => props.onPick(null)}>
            <X />
            移除
          </Button>
        </>
      )}
    </div>
  )
}
