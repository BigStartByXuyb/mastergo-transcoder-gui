import { useState } from "react"
import { Copy, FolderOpen, Loader2, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { IdentifierText } from "@/app/identifier-text"
import {
  PluginInstallBadge,
  SourceAlsoFrom,
  SourceCopyCount,
  SourceResolvedRoot,
  SourceStatusBadge,
  SourceVersion
} from "@/app/plugin-source-facts"
import { api, type PluginUpdateStatus } from "@/lib/api"
import { copyText } from "@/app/copy-text"
import { describeFailure } from "@/lib/describe-failure"
import { describePluginInstall } from "@/lib/plugin-install"
import {
  INSTALL_SLOT_ID,
  isInstallRow,
  PLUGIN_BUSY,
  canChooseThis,
  chooseKeyOf,
  choosePathOf,
  type PluginSourceRow
} from "@/lib/plugin-sources"
import { describeTask, taskFailureNote, taskPercent } from "@/lib/update-state"


/*
 * 插件页某一行点开后的面板 —— 按这一档是「谁在管」分三种：
 *   客户端自带：检查更新 / 下载并安装 / 进度（客户端自己装并维护的那一份）
 *   其余各档：只读展示 + 「用这份」——它们的增删改归各自的来源管
 *   （启动参数、系统环境变量、两个 agent、以及插件页上面那条「我指定的那一份」）。
 *
 * 版本、路径、这一处几份、「正在用」这些事实都来自同一份来源清单（后端 pluginSources()）。
 */

/* 每一档「归谁管」。变量名、路径这些标识符一律用后端给的那一份（row.label），这里不重述。 */
const KIND_NOTE: Record<string, string> = {
  arg: "启动参数 --plugin 给的那一份：只被它自己压过（--plugin 指错客户端会直接停下）。改它要在启动时换参数。",
  env: "系统环境变量给的那一份：在系统里设（或启动前设），客户端启动时继承，新起的进程才读到。",
  agent: "这一份归 Codex / Claude 自己管：客户端只读不改，装与更新都在它们那边做。",
  install: "客户端自带的那一份：机器上没有 Codex / Claude 时，用它「下载并安装」装一份。",
  chosen: "这一档就是插件页上面那条「我指定的那一份」：用上面的「指定一个目录…」换，或用「交给客户端找」清掉。"
}

export function PluginSourceDialog(props: {
  row: PluginSourceRow
  /** 自带那一份的状态（插件页在轮询它）；这一行里没有自带的（members 不含 install）时传 null。 */
  update: PluginUpdateStatus | null
  /** 来源清单那一半的忙碌位（换这份 / 选目录 / 读清单）：只有它是这一行自己的动作。 */
  busy: string
  /** 自带那一半的忙碌位（检查 / 安装）：两半各报各的，不合成一个字符串。 */
  updateBusy: string
  /**
   * 这一刻能不能动「换一份 / 改发布源 / 装一份」：卡片算一次传进来（那边也是三个来源合一），
   * 面板不自己再算一遍 —— 否则规则一改就会出现「卡片上能点、面板里不能点」。
   */
  frozen: boolean
  /** 正在传（下载 / 落盘）：出进度条、按钮转圈。 */
  transferring: boolean
  /** 「检查更新」能不能点：与卡片上那颗同一个判据（use-plugin-update 算好）。 */
  canCheck: boolean
  onClose: () => void
  /** 换一份：把这一档解析到的插件根交给客户端（用这份）。 */
  onChoose: (path: string, key: string) => void
  onCheck: () => void
  onInstall: () => void
}) {
  const [failure, setFailure] = useState("")
  const row = props.row
  /* 这一行里有没有「客户端自带」那一档：有就带更新块（检查更新 / 下载并安装 / 进度）。
     自带的副本正好被指针指着时（两者合成一行），管理的入口也在这一行上。 */
  const install = isInstallRow(row)
  // 「这一行就是自带那一档本身」（而不是别的档并进了它）：比的是档位 id，不是 kind ——
  // 那是两个取值域（kind 只有 arg/chosen/env/agent/install，id 是八个档位各自的 id）。
  const ownInstall = row.id === INSTALL_SLOT_ID

  const summary = describePluginInstall(props.update)
  const transferring = props.transferring
  const taskFailure = props.update ? taskFailureNote(props.update.task) : ""
  // 这一块本来就在「这一行里有自带那一档」时才渲染，所以不用再与一次 install。
  const canInstall = summary.canInstall && !props.frozen

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
            <SourceStatusBadge row={row} />
          </DialogTitle>
          <DialogDescription>
            查找顺序里的第 {row.order} 档。{KIND_NOTE[row.kind] || ""}
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

          {/* 客户端自带那一份：状态与两个动作在这里，行内不再各摆一套。 */}
          {install && (
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                {/* 状态徽章与来源表里自带那一行读同一个组件（文字与色调同一处）。 */}
                <PluginInstallBadge status={props.update} />
                {props.update && props.update.busy && (
                  <span className="text-muted-foreground text-xs">
                    {"有任务在跑（" + props.update.busy + "），先等它跑完再装。"}
                  </span>
                )}
              </div>
              {summary.note && !transferring && <span className="text-muted-foreground text-xs">{summary.note}</span>}
              {transferring && props.update && (
                <div className="flex flex-col gap-1">
                  <Progress value={taskPercent(props.update.task)} />
                  <span className="text-muted-foreground text-xs">{describeTask(props.update.task)}</span>
                </div>
              )}
              {!transferring && taskFailure && <span className="text-destructive text-xs">{taskFailure}</span>}
            </div>
          )}
        </div>

        {failure && <span className="text-destructive text-xs">{failure}</span>}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            /*
             * 有插件才给「打开目录」：「这一档解析到插件」就是「那个目录真的在」（定位只认这个），
             * 而没设 / 那里没有插件的那几档，点了只会报「这个目录不在了」。
             */
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
            {canChooseThis(row) && (
              <Button
                size="sm"
                variant="outline"
                disabled={props.frozen}
                aria-busy={props.busy === chooseKeyOf(row)}
                /*
                 * 记哪个目录由 choosePathOf 说（库那一处）：记这一档所在的目录，不是此刻那一个版本目录。
                 */
                onClick={() => props.onChoose(choosePathOf(row), chooseKeyOf(row))}
              >
                {props.busy === chooseKeyOf(row) && <Loader2 className="size-4 animate-spin" />}
                用这份
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {install && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!props.canCheck}
                  aria-busy={props.updateBusy === PLUGIN_BUSY.check}
                  onClick={() => props.onCheck()}
                >
                  {props.updateBusy === PLUGIN_BUSY.check ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  检查更新
                </Button>
                <Button
                  size="sm"
                  disabled={!canInstall}
                  aria-busy={props.updateBusy === PLUGIN_BUSY.install || transferring}
                  onClick={() => props.onInstall()}
                >
                  {(props.updateBusy === PLUGIN_BUSY.install || transferring) && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {summary.action}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
