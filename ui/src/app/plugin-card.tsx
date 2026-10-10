import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClampText } from "@/app/clamp-text"
import { PixelLoader } from "@/app/pixel-loader"
import { LookupOrder } from "@/app/plugin-order-bar"
import { PluginSourceDialog } from "@/app/plugin-source-dialog"
import { PluginSourceTable } from "@/app/plugin-source-table"
import { SourceDialog } from "@/app/source-dialog"
import { usePluginSources } from "@/app/use-plugin-sources"
import { usePluginUpdate } from "@/app/use-plugin-update"
import { sourceViewOf } from "@/lib/source-check"
import { busyNow } from "@/lib/update-state"
import {
  isInstallRow,
  isOverridden,
  pluginLookup
} from "@/lib/plugin-sources"

// 插件：转码引擎来自 mastergo-wpf-transcoder 插件，客户端不自带引擎。
//
// 这一页只说两件事，各占一处，不重复：
//   按什么顺序找 —— 上面那条顺序，每一档都列出来（后端给的顺序，界面不重排）
//   每一档是什么 —— 一张表：来源 / 版本 / 状态 / 路径 / 操作；点开某一行是那一档的详情，
//                  点开「客户端自带」那一行是它的管理：更新来源（GitHub / GitLab / 静态目录，
//                  与「程序更新」同一个弹窗，但存的是插件自己那一项设置：没配＝插件仓库）
//                  + 检查更新 / 下载并安装 / 进度。
// 这一页只读与查看，不给「换用某一档」：换用只用启动参数与环境变量那两档（顺序见 lib/plugin-root.js）。
//
// 取数分两半，各有各的 hook：来源清单（use-plugin-sources）、
// 自带那一份的更新与轮询（use-plugin-update）；本组件只编排与渲染。
export function PluginCard() {
  const [opened, setOpened] = useState("")
  const [editingSource, setEditingSource] = useState(false)
  const sources = usePluginSources()
  const update = usePluginUpdate(() => void sources.load())

  const lookup = sources.view ? pluginLookup(sources.view.sources) : { slots: [], rows: [] }
  const selected = lookup.rows.find((row) => row.id === opened) ?? null
  /*
   * 有任一半在跑、后端有任务、或正在传，就冻住「改发布源 / 装一份」这类动作：判据是 lib/update-state
   * 的 busyNow（与「程序更新」那张卡同一处）。这里只把这一页的三路忙位摆出来 ——
   * 「哪一半的哪个动作在跑」仍由各自那一半的 busy 字符串回答，不合成成同一个字符串再比对。
   */
  const frozen = busyNow([
    { busy: sources.busy },
    { busy: update.busy, transferring: update.transferring },
    { busy: update.update ? update.update.busy : "" }
  ])

  // 手动切换：再点当前生效的那一行 = 取消（回到自动查找顺序）。
  function toggleOverride(id: string) {
    const current = sources.view?.override ?? ""
    const row = lookup.rows.find((item) => item.id === id) ?? null
    const next = row && isOverridden(row, current) ? "" : id
    void sources.override(next)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>插件</CardTitle>
        <CardDescription>
          转码引擎来自插件：按下面那条顺序找，表格逐档对到它找到的那一份。
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
            <AlertTitle>没找到插件</AlertTitle>
            <AlertDescription>
              <ClampText lines={5} text={sources.view.plugin.failure} />
            </AlertDescription>
          </Alert>
        )}

        {sources.view && (
          <>
            {/* 查找顺序：每一档一句话，谁在生效、谁没有、哪两档是同一份，一眼看完。 */}
            <LookupOrder slots={lookup.slots} onOpen={(id) => setOpened(id)} />

            {/* 表：与顺序一一对应（同一份插件只列一行），点开某一行是那一档的详情 / 管理。 */}
            <PluginSourceTable
              rows={lookup.rows}
              update={update.update}
              override={sources.view.override}
              onOpen={(id) => setOpened(id)}
              onOverride={toggleOverride}
            />

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

        {selected && (
          <PluginSourceDialog
            row={selected}
            update={isInstallRow(selected) ? update.update : null}
            busy={update.busy}
            frozen={frozen}
            transferring={update.transferring}
            canCheck={update.canCheck}
            // 自带那一份的「更新来源」摆在它的管理面板里（那一块只对它有意义）。
            onEditSource={() => setEditingSource(true)}
            onClose={() => setOpened("")}
            onCheck={() => void update.check()}
            onInstall={() => void update.install()}
          />
        )}
      </CardContent>
    </Card>
  )
}
