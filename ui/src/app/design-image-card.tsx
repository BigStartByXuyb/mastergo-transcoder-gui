import { useCallback, useEffect, useState } from "react"
import { Image as ImageIcon, Loader2, Upload } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { IdentifierText } from "@/app/identifier-text"
import { IMAGE_ACCEPT, useFilePick } from "@/app/use-file-pick"
import { useValueRunner } from "@/app/use-action-runner"
import { useAlive } from "@/app/use-alive"
import { api, type BoardTask, type DesignImage } from "@/lib/api"
import { fileToBase64, humanSize } from "@/lib/upload-files"

/*
 * 作业A 的设计稿位图：那条「读图」开关的输入。
 *
 * 这一块只说三件事，与后端 lib/design-image.js 一一对应：图在哪（那一处目录由后端给）／
 * 尺寸对不对（必须等于 DSL 画板尺寸）／分组表在不在（有图必须有表，否则布局推导那一步停下）。
 * 目录、约定名、「尺寸不对 / 不是位图 / 画板尺寸还不知道」的原话都由后端给（判据都在它那一处），这里只渲染。
 */

function sizeText(size: { width: number; height: number } | null): string {
  return size ? size.width + "×" + size.height : "还不知道"
}

export function DesignImageCard({ task }: { task: BoardTask }) {
  const [state, setState] = useState<DesignImage | null>(null)
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState("")
  const alive = useAlive()
  const picked = useFilePick((file) => void save(file))
  const projectRoot = task.workDir
  const target = task.request.target

  /*
   * 两个动作都走共用骨架（ui/src/app/use-action-runner.ts）：
   *   runRead —— 读：不动「正在做」（后台刷新不该让按钮闪一下）；
   *   run     —— 存图：置忙、失败写同一处原话、收尾复位。
   * 「卸载之后迟到的响应不回写」由 done 里的 alive 守卫管。
   */
  const runRead = useValueRunner({ setWorking: () => undefined, setFailure: setFailure })
  const run = useValueRunner({ setWorking: setBusy, setFailure: setFailure })

  const load = useCallback(async () => {
    if (!projectRoot || !target) return
    await runRead("", () => api.designImage(projectRoot, target), (payload) => {
      if (alive.current) setState(payload.image)
    })
  }, [alive, projectRoot, target, runRead])

  /*
   * 任务每往前走一步（看板在轮询）就重读一次：画板尺寸来自固化快照那一步的产物，
   * 挂载时那份快照可能还没有 —— 只读一次的话「DSL 画板」会一直是「还不知道」。
   */
  useEffect(() => {
    void load()
  }, [load, task.updatedAt, task.progress?.done])

  async function save(file: File | null) {
    if (!file) return
    // 上传完直接落状态（不重读一次）；卸载之后迟到的响应不回写，与 load() 同一套守卫。
    await run(
      "save",
      async () => api.saveDesignImage({ projectRoot, target, data: await fileToBase64(file) }),
      (payload) => {
        if (alive.current) setState(payload.image)
      }
    )
  }

  const image = state?.image ?? null
  const canvas = state?.canvas ?? null
  // 「一致 / 不一致」直接读后端给的 matches（那条判据只有一处），界面不再拿 image+canvas 重算一遍。
  const matched = Boolean(state?.matches)
  const mismatch = Boolean(image && canvas && !matched)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          设计稿位图
          <Badge variant={image ? "secondary" : "outline"}>{image ? "有图" : "没有图"}</Badge>
          {matched && <Badge variant="outline">尺寸一致</Badge>}
          {mismatch && <Badge variant="destructive">尺寸不一致</Badge>}
          {image && !state?.groups.exists && <Badge variant="destructive">缺分组表</Badge>}
        </CardTitle>
        <CardDescription>
          作业A 读图是一个开关：按设计稿原始尺寸导出，位图尺寸必须等于 DSL 画板尺寸；有图就必须先有分组表，
          否则布局推导那一步会停下报告。不传图就按纯机械判据推导，照常跑。分组表放在哪、叫什么，下面那一行照实显示。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">DSL 画板（图该有的尺寸）</span>
          {/* 还没有画板尺寸时怎么说，只有后端一处（下面那行照实显示它的原话）。 */}
          <span>{sizeText(canvas)}</span>
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
            ref={picked.input}
            type="file"
            accept={IMAGE_ACCEPT}
            className="hidden"
            onChange={picked.onChange}
          />
          {/* 不能传时按后端给的 reason 显示并禁用（判据在后端，这里只渲染）。 */}
          <Button size="sm" variant="outline" disabled={busy !== "" || Boolean(state?.blocked)} onClick={() => picked.input.current?.click()}>
            {busy !== "" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {image ? "换一张" : "选择位图…"}
          </Button>
          <span className="text-muted-foreground text-xs">
            {state?.blocked || "按设计稿原始尺寸导出（不是截图工具随手截的那一张）"}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
