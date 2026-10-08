import { useCallback, useEffect, useRef, useState } from "react"
import { Image as ImageIcon, Loader2, Upload } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { IdentifierText } from "@/app/identifier-text"
import { useAlive } from "@/app/use-alive"
import { api, type BoardTask, type DesignImage } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { fileToBase64, humanSize } from "@/lib/upload-files"

/*
 * 作业A 的设计稿位图：那条「读图」开关的输入。
 *
 * 这一块只说三件事，与后端 lib/design-image.js 一一对应：
 *   图在哪（<工程目录>/Generated/_inputs/<页面名>.design.png）／尺寸对不对（必须等于 DSL 画板尺寸）／
 *   分组表在不在（有图必须有表，否则第 8 步停下）。
 * 「尺寸不对」「不是位图」的原话由后端给（它才是那条判据），这里只渲染。
 */

function sizeText(size: { width: number; height: number } | null): string {
  return size ? size.width + "×" + size.height : "还不知道"
}

export function DesignImageCard({ task }: { task: BoardTask }) {
  const [state, setState] = useState<DesignImage | null>(null)
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const alive = useAlive()
  const projectRoot = task.workDir
  const target = task.request.target

  const load = useCallback(async () => {
    if (!projectRoot || !target) return
    try {
      const payload = await api.designImage(projectRoot, target)
      if (alive.current) setState(payload.image)
    } catch (error) {
      if (alive.current) setFailure(describeFailure(error))
    }
  }, [alive, projectRoot, target])

  /*
   * 任务每往前走一步（看板在轮询）就重读一次：画板尺寸来自第 2 步的快照，
   * 挂载时那份快照可能还没有 —— 只读一次的话「DSL 画板」会一直是「还不知道」。
   */
  useEffect(() => {
    void load()
  }, [load, task.updatedAt, task.progress?.done])

  async function picked(file: File | undefined) {
    if (!file) return
    setFailure("")
    setBusy(true)
    try {
      // 上传完直接落状态（不重读一次）；卸载之后迟到的响应不回写，与 load() 同一套守卫。
      const payload = await api.saveDesignImage({
        projectRoot,
        target,
        data: await fileToBase64(file)
      })
      if (alive.current) setState(payload.image)
    } catch (error) {
      if (alive.current) setFailure(describeFailure(error))
    } finally {
      if (alive.current) setBusy(false)
      // 选同一个文件两次也要能再传一次（input 的 value 不清就只响一次）。
      if (input.current) input.current.value = ""
    }
  }

  const image = state?.image ?? null
  const canvas = state?.canvas ?? null
  const mismatch = Boolean(image && canvas && !state?.matches)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          设计稿位图
          <Badge variant={image ? "secondary" : "outline"}>{image ? "有图" : "没有图"}</Badge>
          {image && canvas && !mismatch && <Badge variant="outline">尺寸一致</Badge>}
          {mismatch && <Badge variant="destructive">尺寸不一致</Badge>}
          {image && !state?.groups.exists && <Badge variant="destructive">缺分组表</Badge>}
        </CardTitle>
        <CardDescription>
          作业A 读图是一个开关：按设计稿原始尺寸导出，位图尺寸必须等于 DSL 画板尺寸；有图就必须先有分组表
          （<span className="font-mono">&lt;页面名&gt;.layout-groups.json</span>），否则第 8 步会停下报告。
          不传图就按纯机械判据推导，照常跑。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">DSL 画板（图该有的尺寸）</span>
          <span>
            {sizeText(canvas)}
            {!canvas && <span className="text-muted-foreground">（还没跑到第 2 步，取数之后才知道）</span>}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">这一页放着的图</span>
          {image ? (
            <span className="flex flex-wrap items-center gap-2">
              <ImageIcon className="size-4" />
              <span className="font-mono">{image.name}</span>
              {/* 文件头读不出宽高时（文件坏了、或不是位图）照实说，别显示 0×0。 */}
              <span>{image.width > 0 ? image.width + "×" + image.height : "这一份读不出尺寸"}</span>
              <span className="text-muted-foreground text-xs">{humanSize(image.bytes)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {state ? "还没有。传上来的话放到 " + state.dir : "请稍等，正在读这一页的目录"}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">分组表（有图就必须有）</span>
          <span>{state?.groups.exists ? "有" : "还没有"}</span>
          {state && <IdentifierText className="text-muted-foreground text-xs" text={state.groups.path} />}
        </div>

        {failure && <span className="text-destructive text-xs">{failure}</span>}

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            // 按内容认格式（后端那条判据），所以选择框只按大类筛一下，别用后缀把改名过的文件挡在外面。
            accept="image/*"
            className="hidden"
            onChange={(event) => void picked(event.target.files?.[0])}
          />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {image ? "换一张" : "选择位图…"}
          </Button>
          <span className="text-muted-foreground text-xs">
            只接 PNG / JPEG；按设计稿原始尺寸导出（不是截图工具随手截的那一张）
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
