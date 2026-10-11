import { useEffect, useState } from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { IMAGE_ACCEPT, useFilePick } from "@/app/use-file-pick"
import { humanSize } from "@/lib/upload-files"

/*
 * 设计稿位图的选图框：一个「＋」磁贴，选好之后磁贴里就是那张图的缩略图（再点它＝换一张）。
 * 新建任务那张表单与看板的创建任务弹窗共用这一份，磁贴边长也同一档 —— 两张表单摆在一起不会一高一矮。
 *
 * 只管「手里拿着哪张图」—— 暂存、尺寸核对、格式判据都在后端（ui/src/app/stage-design-images.ts
 * 送过去、lib/design-image.js 判），所以在任务建出来之前这里选什么都不拦。
 */

/* 默认那句：新建任务那张表单上只一个框，说一句「点加号选一张」有用。 */
const DEFAULT_EMPTY_HINT = "点加号选一张"

/*
 * 磁贴：点它（label）开选择框；文件框本身用 sr-only 藏在里面 —— 视觉上不可见但**能聚焦**，
 * 所以 Tab 能到、回车 / 空格能开（Tailwind 的 hidden 是 display:none，会把这个入口整段掐掉）。
 * 聚焦时由 focus-within 把边框点亮：焦点在里面的文件框上，看得见的是这个磁贴。
 */
const TILE_CLASS =
  "relative flex size-16 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-input text-muted-foreground hover:border-primary hover:text-primary focus-within:border-primary focus-within:text-primary"

export function DesignImagePicker(props: {
  id: string
  file: File | null
  onPick: (file: File | null) => void
  /** 空着时磁贴旁边那句话：看板弹窗一行一个框、多行时重复着太吵，那一侧传空串。 */
  emptyHint?: string
}) {
  const picked = useFilePick(props.onPick)
  const [preview, setPreview] = useState("")

  /* 本地预览：换一张或卸载时把上一个对象地址放掉（不放会一直占着那份文件的内存）。 */
  useEffect(() => {
    if (!props.file) {
      setPreview("")
      return
    }
    const url = URL.createObjectURL(props.file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [props.file])

  return (
    <div className="flex min-w-0 items-center gap-3">
      {/* 点磁贴就是点这个 label（文件框本身藏起来）；id 同时留给外面那个 Label 关联。 */}
      <label htmlFor={props.id} title={props.file ? "换一张位图" : "选择设计稿位图（按设计稿原尺寸导出）"} className={TILE_CLASS}>
        <input
          ref={picked.input}
          id={props.id}
          type="file"
          accept={IMAGE_ACCEPT}
          className="sr-only"
          onChange={picked.onChange}
        />
        {preview ? <img src={preview} alt="" className="size-full object-cover" /> : <Plus className="size-5" />}
      </label>
      {props.file ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="max-w-56 truncate text-xs" title={props.file.name}>
            {props.file.name}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground text-xs">
            {humanSize(props.file.size)}
            <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => props.onPick(null)}>
              <X className="size-3" />
              移除
            </Button>
          </span>
        </div>
      ) : (
        <span className="text-muted-foreground text-xs">{props.emptyHint ?? DEFAULT_EMPTY_HINT}</span>
      )}
    </div>
  )
}
