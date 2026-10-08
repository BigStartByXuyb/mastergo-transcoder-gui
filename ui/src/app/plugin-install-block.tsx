
import { Progress } from "@/components/ui/progress"
import { BusyActionButton } from "@/app/busy-action-button"
import { CheckUpdateButton } from "@/app/update-source-actions"
import { PluginInstallBadge } from "@/app/plugin-source-facts"
import { UpdateSourceRow } from "@/app/update-source-row"
import type { PluginUpdateStatus } from "@/lib/api"
import { describePluginInstall } from "@/lib/plugin-install"
import { PLUGIN_BUSY } from "@/lib/plugin-sources"
import { describeTask, taskFailureNote, taskPercent } from "@/lib/update-state"

/*
 * 「客户端自带那一份」这一块。行内面板里自带那一行点开就是这个，与表里那一行、顺序条上那一档说的是同一份状态。
 *
 * 分两块导出，按「实现在哪一半」切：
 *   PluginInstallBlock   面板正文：更新来源那一行（含它自己的「修改发布源」按钮 —— 弹窗同一个，
 *                        存的是插件自己那一项设置，没配时按插件仓库取，见 lib/source.js 的 pluginSourceOf）、
 *                        状态（有新版 / 是最新 / 未检查 / 检查失败）与进度
 *   PluginInstallActions 面板页脚：两个动作 —— 检查更新 / 下载并安装
 * 两面动作的松紧不一样：检查只读远端，装会写盘、还可能换掉生效的那一份，所以装那颗用整页的 `frozen`。
 */

export function PluginInstallBlock(props: {
  status: PluginUpdateStatus | null
  /** 正在传（下载 / 落盘）：出进度条。 */
  transferring: boolean
  /** 这一刻能不能改发布源（任一半在跑就不给改）。 */
  frozen: boolean
  /** 改发布源：开那个弹窗（表单同一个，存进插件那一项设置）。 */
  onEditSource: () => void
}) {
  const summary = describePluginInstall(props.status)
  const taskFailure = props.status ? taskFailureNote(props.status.task) : ""
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      {/*
       * 这一份从哪儿取：插件自己那一项设置（后端 lib/source.js 一处拼地址）——
       * 默认基址是插件仓库，配过就用配的那个，
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
  /** 整页闲不闲（含来源清单那一半）：装会写盘、还可能换掉生效的那一份，所以比「检查更新」严一档。 */
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
      <BusyActionButton
        label={summary.action}
        variant="default"
        busy={installing}
        disabled={!summary.canInstall || props.frozen}
        onClick={props.onInstall}
      />
    </>
  )
}
