/*
 * 插件来源那一行的弹窗：别的档位给只读详情（版本 / 路径 / 解析到哪一份 / 这一档归谁管）；
 * 「客户端自带」那一档多一块更新（检查更新 / 下载并安装 / 更新来源），实现在 plugin-install-block。
 */
import { useState } from "react"
import { Copy, FolderOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { IdentifierText } from "@/app/identifier-text"
import { PluginInstallActions, PluginInstallBlock } from "@/app/plugin-install-block"
import {
  SourceAlsoFrom,
  SourceCopyCount,
  SourceResolvedRoot,
  SourceStatusBadge,
  SourceVersion
} from "@/app/plugin-source-facts"
import { api, type PluginUpdateStatus } from "@/lib/api"
import { copyText } from "@/app/copy-text"
import { describeFailure } from "@/lib/describe-failure"
import {
  INSTALL_SLOT_ID,
  isInstallRow,
  type PluginSourceRow
} from "@/lib/plugin-sources"


/*
 * 插件页某一行点开后的面板 —— 按这一档是「谁在管」分两种：
 *   客户端自带：检查更新 / 下载并安装 / 进度（客户端自己装并维护的那一份）
 *   其余各档：只读展示 —— 它们的增删改归各自的来源管
 *   （启动参数、系统环境变量、两个 agent 的缓存）。这一页不给「换用某一档」。
 *
 * 版本、路径、这一处几份、「正在用」这些事实都来自同一份来源清单（后端 pluginSources()）。
 */

export function PluginSourceDialog(props: {
  row: PluginSourceRow
  /** 自带那一份的状态（插件页在轮询它）；这一行里没有自带的（members 不含 install）时传 null。 */
  update: PluginUpdateStatus | null
  /** 自带那一半的忙碌位（PLUGIN_BUSY 的 check / install）：面板按它比才知道是哪一颗在跑。 */
  busy: string
  /**
   * 这一刻能不能动「换一份 / 改发布源 / 装一份」：卡片算一次传进来（那边也是三个来源合一），
   * 面板不自己再算一遍 —— 否则规则一改就会出现「卡片上能点、面板里不能点」。
   */
  frozen: boolean
  /** 正在传（下载 / 落盘）：出进度条、按钮转圈。 */
  transferring: boolean
  /** 「检查更新」能不能点：use-plugin-update 算好的那一个判据（只读动作；装那一颗更严，见下方注释）。 */
  canCheck: boolean
  /** 改发布源：这一档（自带那一份）的「更新来源」在它自己的块里。 */
  onEditSource: () => void
  onClose: () => void
  onCheck: () => void
  onInstall: () => void
}) {
  const [failure, setFailure] = useState("")
  const row = props.row
  /* 这一行里有没有「客户端自带」那一档：有就带更新块（检查更新 / 下载并安装 / 进度）。
     自带的副本正好被指针指着时（两者合成一行），管理的入口也在这一行上。 */
  const install = isInstallRow(row)
  // 「这一行就是自带那一档本身」（而不是别的档并进了它）：比的是档位 id（后端给的七档 id 之一）。
  const ownInstall = row.id === INSTALL_SLOT_ID

  const transferring = props.transferring

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
            查找顺序里的第 {row.order} 档。{row.note}
            {install && !ownInstall && "这一份同时也是「客户端自带」那一份，下面可以检查、下载它。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          {/* 这一档解析到的那一份：版本、路径、这一处有几份。 */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">这一档</span>
            <span className="text-xs">
              版本：<SourceVersion row={row} />
            </span>
            <SourceCopyCount row={row} />
            <IdentifierText className="text-muted-foreground text-xs" text={row.path} />
            <SourceResolvedRoot row={row} />
            <SourceAlsoFrom row={row} />
          </div>

          {/* 客户端自带那一份：更新来源、状态与进度（那一块的实现在 plugin-install-block）。 */}
          {install && (
            <PluginInstallBlock
              status={props.update}
              transferring={transferring}
              frozen={props.frozen}
              onEditSource={props.onEditSource}
            />
          )}
        </div>

        {failure && <span className="text-destructive text-xs">{failure}</span>}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {/* 有插件才给「打开目录」：exists 蕴含 path 非空（「解析到插件」就是「那个目录真的在」）。 */}
            {row.exists && (
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
            {install && (
              <PluginInstallActions
                status={props.update}
                busy={props.busy}
                transferring={transferring}
                frozen={props.frozen}
                canCheck={props.canCheck}
                onCheck={props.onCheck}
                onInstall={props.onInstall}
              />
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
