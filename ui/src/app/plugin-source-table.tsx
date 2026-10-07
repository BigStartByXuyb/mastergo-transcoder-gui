import type { ReactNode } from "react"
import { FolderSearch, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { IdentifierText } from "@/app/identifier-text"
import { ChooseSourceButton } from "@/app/update-source-actions"
import { PluginInstallBadge, SourceAlsoFrom, SourceCopyCount, SourceStatusBadge, SourceVersion } from "@/app/plugin-source-facts"
import {
  CHOSEN_SLOT_ID,
  isInstallRow,
  canChooseThis,
  chooseKeyOf,
  PLUGIN_BUSY,
  type PluginSourceRow
} from "@/lib/plugin-sources"
import type { PluginUpdateStatus } from "@/lib/api"

/*
 * 来源表：来源 / 版本 / 状态 / 路径 / 操作。与上面那条查找顺序一一对应（同一份插件只列一行）。
 * 「自带那一行」还带一句它自己的更新状态（有新版 / 是最新 / 未检查 / 检查失败），表里就能看见要不要去管。
 * 「我指定的那一份」这一档的两个动作（指定 / 换一个目录、交给客户端找）就落在承载它的那一行上：
 * 这一档不再另占页面顶层一块 —— 它的位置就是它在查找顺序里的位置。
 */

export function PluginSourceTable(props: {
  rows: PluginSourceRow[]
  /** 自带那一份的状态（这一行里没有自带的也能传，只是不加那个更新状态徽章）。 */
  update: PluginUpdateStatus | null
  /** 设置里存的那一份（空串＝按顺序自动）：决定「我指定的那一份」那一行的按钮怎么写。 */
  chosen: string
  /** 来源清单那一半的忙碌位：只有拿它比行 id 才是「这一行自己的动作在跑」。 */
  busy: string
  /** 哪一半在跑都算忙：忙的时候不给换一份。 */
  frozen: boolean
  onOpen: (rowId: string) => void
  /** 换一份：记这一档所在的目录（记哪个由 lib/plugin-sources 的 choosePathOf 说）。 */
  onChoose: (row: PluginSourceRow) => void
  /** 指定 / 换一个目录（选目录那条路）。 */
  onPick: () => void
  /** 交给客户端找：清掉指定的那一份，回到按顺序自动。 */
  onAuto: () => void
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[22%]">来源</TableHead>
            <TableHead className="w-[12%]">版本</TableHead>
            <TableHead className="w-[14%]">状态</TableHead>
            <TableHead>路径</TableHead>
            <TableHead className="w-[24%] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row) => (
            <PluginSourceLine
              key={row.id}
              row={row}
              installState={isInstallRow(row) ? <PluginInstallBadge status={props.update} /> : null}
              chosen={props.chosen}
              busy={props.busy}
              frozen={props.frozen}
              onOpen={() => props.onOpen(row.id)}
              onChoose={() => props.onChoose(row)}
              onPick={props.onPick}
              onAuto={props.onAuto}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// 表里的一行。自带那一行带一句它自己的更新状态，动作给的是「管理…」（那一行里同时也挂着自带那一档）。
function PluginSourceLine(props: {
  row: PluginSourceRow
  /** 自带那一行那一格的状态徽章（别的行给 null）。 */
  installState: ReactNode
  chosen: string
  busy: string
  frozen: boolean
  onOpen: () => void
  onChoose: () => void
  onPick: () => void
  onAuto: () => void
}) {
  const row = props.row
  // 这一行是不是承载「我指定的那一份」那一档：指定的那份与别的档合成一行时（同一份插件），
  // 动作跟着这一行走 —— 它就是那一份插件的行。
  const ownsChosen = row.members.includes(CHOSEN_SLOT_ID)

  return (
    <TableRow className="cursor-pointer" onClick={props.onOpen}>
      <TableCell className="align-top text-sm whitespace-normal">
        <span className="block">
          <span className="text-muted-foreground">{row.order}.</span> <span>{row.label}</span>
        </span>
        <SourceAlsoFrom row={row} />
      </TableCell>
      <TableCell className="align-top text-xs whitespace-normal">
        <SourceVersion row={row} />
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <SourceStatusBadge active={row.active} exists={row.exists} />
        {props.installState && <span className="block pt-1">{props.installState}</span>}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        {ownsChosen && !props.chosen ? (
          // 没指定时这一格本来是空的：把「为什么没指定也照常转码」说在这里，不另占一块。
          <span className="text-muted-foreground text-xs">没指定：按这个顺序往下找，现在用的是标「正在用」的那一条。</span>
        ) : (
          <>
            <IdentifierText className="text-muted-foreground text-xs" text={row.path} />
            <SourceCopyCount row={row} />
          </>
        )}
      </TableCell>
      <TableCell className="align-top text-right whitespace-normal">
        {/* 挤不下就换行：这一格在窄窗口里要放三颗按钮（换目录 / 交给客户端找 / 详情）。 */}
        <div className="flex flex-wrap justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          {/* 「我指定的那一份」这一档：指定/换一个目录、交给客户端找（清掉）。 */}
          {ownsChosen && (
            <Button
              size="sm"
              variant="outline"
              disabled={props.frozen}
              aria-busy={props.busy === PLUGIN_BUSY.pick}
              onClick={props.onPick}
            >
              {props.busy === PLUGIN_BUSY.pick ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FolderSearch className="size-4" />
              )}
              {props.chosen ? "换个目录…" : "指定一个目录…"}
            </Button>
          )}
          {ownsChosen && (
            <Button
              size="sm"
              variant="outline"
              disabled={props.frozen || !props.chosen}
              aria-busy={props.busy === PLUGIN_BUSY.auto}
              onClick={props.onAuto}
            >
              {props.busy === PLUGIN_BUSY.auto && <Loader2 className="size-4 animate-spin" />}
              交给客户端找
            </Button>
          )}
          {canChooseThis(row) && (
            <ChooseSourceButton busy={props.busy === chooseKeyOf(row)} disabled={props.frozen} onClick={props.onChoose} />
          )}
          <Button size="sm" variant="outline" onClick={props.onOpen}>
            {isInstallRow(row) ? "管理…" : "详情…"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
