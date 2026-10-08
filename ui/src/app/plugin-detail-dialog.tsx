import { useState } from "react"
import { Copy, FolderOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { IdentifierText } from "@/app/identifier-text"
import { PluginInstallActions, PluginInstallBlock } from "@/app/plugin-install-block"
import {
  SourceCopyCount,
  SourceResolvedRoot,
  SourceStatusBadge,
  SourceVersion
} from "@/app/plugin-source-facts"
import { api, type PluginSource, type PluginUpdateStatus } from "@/lib/api"
import { copyText } from "@/app/copy-text"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 插件页「更多」点开后的面板 —— 客户端自带那一份的管理入口：
 * 这一份装在哪儿、是哪一版、那儿有几份（事实），更新来源（从哪儿取新版），
 * 以及三个动作：打开目录 / 复制路径 / 检查更新 / 下载并安装。
 *
 * 事实来自同一份来源清单（后端 pluginSources()），动作归各自那一半的 hook —— 这个组件只渲染。
 */

export function PluginDetailDialog(props: {
  row: PluginSource
  /** 自带那一份的状态（插件页在轮询它）。 */
  update: PluginUpdateStatus | null
  /** 正在传（下载 / 落盘）：出进度条、按钮转圈。 */
  transferring: boolean
  /** 这一刻能不能改发布源 / 装新版（任一半在跑或后端有任务就不给）。 */
  frozen: boolean
  /** 「检查更新」能不能点：use-plugin-update 算好的那一个判据。 */
  canCheck: boolean
  /** 自带那一半的忙碌位（PLUGIN_BUSY 的 check / install）。 */
  busy: string
  onEditSource: () => void
  onClose: () => void
  onCheck: () => void
  onInstall: () => void
}) {
  const [failure, setFailure] = useState("")
  const row = props.row

  async function openFolder() {
    setFailure("")
    try {
      const result = await api.openFolder(row.path)
      if (!result.ok) setFailure(result.reason)
    } catch (error) {
      setFailure(describeFailure(error))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {row.label}
            <SourceStatusBadge active={row.active} exists={row.exists} />
          </DialogTitle>
          <DialogDescription>
            客户端自带的那一份插件：机器上没装过它就「下载并安装」装一份，装完立刻生效。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          {/* 这一份本身：版本、路径、这一处有几份、解析到的是哪一个版本目录。 */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">这一份</span>
            <span className="text-xs">
              版本：<SourceVersion row={row} />
            </span>
            <SourceCopyCount row={row} />
            {row.path && <IdentifierText className="text-muted-foreground text-xs" text={row.path} />}
            <SourceResolvedRoot row={row} />
          </div>

          {/* 这一份从哪儿取新版、此刻是哪一版、进度停在哪儿（那一块的实现在 plugin-install-block）。 */}
          <PluginInstallBlock
            status={props.update}
            transferring={props.transferring}
            frozen={props.frozen}
            onEditSource={props.onEditSource}
          />
        </div>

        {failure && <span className="text-destructive text-xs">{failure}</span>}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {/* 有插件才给「打开目录」：「解析到插件」就是「那个目录真的在」（定位只认这个）。 */}
            {row.path && row.exists && (
              <Button size="sm" variant="outline" onClick={() => void openFolder()}>
                <FolderOpen className="size-4" />
                打开目录
              </Button>
            )}
            {row.path && (
              <Button size="sm" variant="outline" onClick={() => void copyText(row.path, "路径")}>
                <Copy className="size-4" />
                复制路径
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <PluginInstallActions
              status={props.update}
              busy={props.busy}
              transferring={props.transferring}
              frozen={props.frozen}
              canCheck={props.canCheck}
              onCheck={props.onCheck}
              onInstall={props.onInstall}
            />
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
