import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ClampText } from "@/app/clamp-text"
import { PixelLoader } from "@/app/pixel-loader"
import { IdentifierText } from "@/app/identifier-text"
import { PluginDetailDialog } from "@/app/plugin-detail-dialog"
import { SourceDialog } from "@/app/source-dialog"
import { PluginInstallBadge, SourceCopyCount, SourceStatusBadge, SourceVersion } from "@/app/plugin-source-facts"
import { usePluginSources } from "@/app/use-plugin-sources"
import { usePluginUpdate } from "@/app/use-plugin-update"
import { sourceViewOf } from "@/lib/source-check"
import { busyNow } from "@/lib/update-state"

// 插件：转码引擎来自 mastergo-wpf-transcoder 插件，客户端不自带引擎。
//
// 插件只有一处来源：客户端自带那一份（装在安装根 plugins/ 下）。这一页只说它：
// 来源 / 版本 / 状态 / 路径四格事实一行看完，「更多」点开是它的管理
// （更新来源 —— GitHub / GitLab / 静态目录，与「程序更新」同一个弹窗，但存的是插件自己那一项设置：
// 没配＝插件仓库 —— 加上检查更新 / 下载并安装 / 进度）。
//
// 取数分两半，各有各的 hook：来源清单（use-plugin-sources）、自带那一份的更新与轮询
// （use-plugin-update）；本组件只编排与渲染。
export function PluginCard() {
  const [opened, setOpened] = useState(false)
  const [editingSource, setEditingSource] = useState(false)
  const sources = usePluginSources()
  const update = usePluginUpdate(() => void sources.load())

  const source = sources.view ? sources.view.sources[0] ?? null : null
  /*
   * 有任一半在跑、后端有任务、或正在传，就冻住「改发布源 / 装一份」这类动作：判据是 lib/update-state
   * 的 busyNow（与「程序更新」那张卡同一处）。这里只把这一页的几路忙位摆出来 ——
   * 「哪一半的哪个动作在跑」仍由各自那一半的 busy 字符串回答，不合成成同一个字符串再比对。
   */
  const frozen = busyNow([
    { busy: sources.busy },
    { busy: update.busy, transferring: update.transferring },
    { busy: update.update ? update.update.busy : "" }
  ])

  return (
    <Card>
      <CardHeader>
        <CardTitle>插件</CardTitle>
        <CardDescription>
          转码引擎来自插件：客户端自带那一份，装在安装根 <span className="font-mono">plugins/</span> 下。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!sources.view && !sources.failure && <PixelLoader text="请稍等，正在查找插件" cell={3} className="py-4" />}

        {sources.failure && (
          <Alert variant="destructive">
            <AlertTitle>出错了</AlertTitle>
            <AlertDescription>
              <ClampText text={sources.failure} />
            </AlertDescription>
          </Alert>
        )}

        {sources.view && sources.view.plugin.failure && (
          <Alert variant="destructive">
            <AlertTitle>没装插件</AlertTitle>
            <AlertDescription>
              <ClampText lines={5} text={sources.view.plugin.failure} />
            </AlertDescription>
          </Alert>
        )}

        {source && (
          <>
            {/* 这一份：来源 / 版本 / 状态 / 路径四格 + 更新状态 + 「更多」。 */}
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">{source.label}</span>
                <SourceVersion row={source} />
                <SourceStatusBadge active={source.active} exists={source.exists} />
                <PluginInstallBadge status={update.update} />
              </div>
              {source.path && <IdentifierText className="text-muted-foreground text-xs" text={source.path} />}
              <SourceCopyCount row={source} />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={!source.exists} onClick={() => setOpened(true)}>
                  更多
                </Button>
              </div>
            </div>

            {/* 两半各自的失败：来源清单那一半与自带那份那一半，谁出事谁说话。 */}
            {update.failure && <span className="text-destructive text-xs">{update.failure}</span>}
            {update.probe && <span className="text-destructive text-xs">{update.probe}</span>}
          </>
        )}

        {editingSource && update.update && (
          <SourceDialog
            subject="插件（流水线）"
            view={sourceViewOf(update.update.source, update.update.hasToken)}
            onClose={() => setEditingSource(false)}
            reload={async () => {
              const latest = await update.refresh()
              return sourceViewOf(latest.source, latest.hasToken)
            }}
            check={update.check}
          />
        )}

        {opened && source && (
          <PluginDetailDialog
            row={source}
            update={update.update}
            busy={update.busy}
            frozen={frozen}
            transferring={update.transferring}
            canCheck={update.canCheck}
            onEditSource={() => setEditingSource(true)}
            onClose={() => setOpened(false)}
            onCheck={() => void update.check()}
            onInstall={() => void update.install()}
          />
        )}
      </CardContent>
    </Card>
  )
}
