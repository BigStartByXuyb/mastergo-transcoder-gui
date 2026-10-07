import { CheckUpdateButton } from "@/app/update-source-actions"
import { UpdateSourceRow } from "@/app/update-source-row"
import { PLUGIN_BUSY } from "@/lib/plugin-sources"
import type { PluginUpdateStatus } from "@/lib/api"

/*
 * 「客户端自带的那一份从哪儿取」这一块：更新来源那一行 + 一颗「检查更新」。
 * 发布源与程序更新是同一处设置（后端 lib/source.js 一处拼地址），所以这里也显示、也能改 ——
 * 「GitHub / GitLab 在哪儿配」不能只有程序更新那一半看得见。
 * 「检查更新」与「管理…」面板里那颗是同一个动作（同一个函数、同一个 canCheck）。
 */

export function PluginInstallSource(props: {
  status: PluginUpdateStatus
  /** 这一刻能不能动（任一半在跑）：忙的时候不给改发布源。 */
  frozen: boolean
  /** 这一条线自己的忙碌位（PLUGIN_BUSY.check 时按钮转圈）。 */
  busy: string
  /** 「检查更新」能不能点（use-plugin-update 算好）。 */
  canCheck: boolean
  onEdit: () => void
  onCheck: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <UpdateSourceRow
        source={props.status.source}
        hasToken={props.status.hasToken}
        disabled={props.frozen}
        onEdit={props.onEdit}
      />
      <div className="flex flex-wrap items-center gap-2">
        <CheckUpdateButton busy={props.busy === PLUGIN_BUSY.check} disabled={!props.canCheck} onClick={props.onCheck} />
        <span className="text-muted-foreground text-xs">要装哪一版，点表里「客户端自带」那一行的「管理…」</span>
      </div>
    </div>
  )
}
