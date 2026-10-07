import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { CheckUpdateButton } from "@/app/update-source-actions"
import { PluginInstallBadge } from "@/app/plugin-source-facts"
import { UpdateSourceRow } from "@/app/update-source-row"
import type { PluginUpdateStatus } from "@/lib/api"
import { describePluginInstall } from "@/lib/plugin-install"
import { PLUGIN_BUSY } from "@/lib/plugin-sources"
import { describeTask, taskFailureNote, taskPercent } from "@/lib/update-state"

/*
 * 「客户端自带那一份」这一块：状态（有新版 / 是最新 / 未检查 / 检查失败）、进度，以及它自己的两个动作
 * （检查更新 / 下载并安装）。行内面板里自带那一行点开就是这个 —— 与卡片上那一块、表里那一行说的是同一份状态。
 * 分两块导出：状态与进度在面板正文里（`PluginInstallBlock`），两个动作在面板页脚右侧（`PluginInstallActions`）。
 */

export function PluginInstallBlock(props: {
  status: PluginUpdateStatus | null
  /** 正在传（下载 / 落盘）：出进度条。 */
  transferring: boolean
  /** 这一刻能不能改发布源（任一半在跑就不给改）。 */
  frozen: boolean
  /** 改发布源：开那个弹窗（与程序更新同一处设置、同一个弹窗）。 */
  onEditSource: () => void
}) {
  const summary = describePluginInstall(props.status)
  const taskFailure = props.status ? taskFailureNote(props.status.task) : ""
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      {/*
       * 这一份从哪儿取：与程序更新同一处设置（后端 lib/source.js 一处拼地址），
       * 而「从哪儿取」只对自带这一份有意义，所以它就摆在这一块里，不占页面顶层。
       */}
      {props.status && (
        <UpdateSourceRow
          source={props.status.source}
          hasToken={props.status.hasToken}
          disabled={props.frozen}
          onEdit={props.onEditSource}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PluginInstallBadge status={props.status} />
        {props.status && props.status.busy && (
          <span className="text-muted-foreground text-xs">
            {"有任务在跑（" + props.status.busy + "），先等它跑完再装。"}
          </span>
        )}
      </div>
      {summary.note && !props.transferring && <span className="text-muted-foreground text-xs">{summary.note}</span>}
      {props.transferring && props.status && (
        <div className="flex flex-col gap-1">
          <Progress value={taskPercent(props.status.task)} />
          <span className="text-muted-foreground text-xs">{describeTask(props.status.task)}</span>
        </div>
      )}
      {!props.transferring && taskFailure && <span className="text-destructive text-xs">{taskFailure}</span>}
    </div>
  )
}

export function PluginInstallActions(props: {
  status: PluginUpdateStatus | null
  /** 自带那一半的忙碌位（PLUGIN_BUSY 的 check / install）。 */
  busy: string
  /** 正在传（下载 / 落盘）：装那颗按钮转圈。 */
  transferring: boolean
  /** 这一刻能不能动（任一半在跑就不给装）。 */
  frozen: boolean
  /** 「检查更新」能不能点（use-plugin-update 算好）。 */
  canCheck: boolean
  onCheck: () => void
  onInstall: () => void
}) {
  const summary = describePluginInstall(props.status)
  const installing = props.busy === PLUGIN_BUSY.install || props.transferring
  return (
    <>
      <CheckUpdateButton
        busy={props.busy === PLUGIN_BUSY.check}
        disabled={!props.canCheck}
        onClick={props.onCheck}
      />
      <Button size="sm" disabled={!summary.canInstall || props.frozen} aria-busy={installing} onClick={props.onInstall}>
        {installing && <Loader2 className="size-4 animate-spin" />}
        {summary.action}
      </Button>
    </>
  )
}
