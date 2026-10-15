import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { IdentifierText } from "@/app/identifier-text"
import { PluginInstallBadge, SourceAlsoFrom, SourceCopyCount, SourceStatusBadge, SourceVersion } from "@/app/plugin-source-facts"
import { canOverride, isInstallRow, isOverridden, type PluginSourceRow } from "@/lib/plugin-sources"
import type { PluginUpdateStatus } from "@/lib/api"

/*
 * 来源表：来源 / 版本 / 状态 / 路径 / 操作。与上面那条查找顺序一一对应（同一份插件只列一行）。
 * 「自带那一行」还带一句它自己的更新状态（有新版 / 是最新 / 未检查 / 检查失败），表里就能看见要不要去管。
 *
 * 操作列：点开是详情 / 管理；非「启动参数 / 环境变量」且确实有插件的档，还能手动切换（覆盖自动查找顺序）。
 */

export function PluginSourceTable(props: {
  rows: PluginSourceRow[]
  /** 自带那一份的状态（这一行里没有自带的也能传，只是不加那个更新状态徽章）。 */
  update: PluginUpdateStatus | null
  /** 当前手动选择的来源 id（空 = 自动）。 */
  override: string
  onOpen: (rowId: string) => void
  onOverride: (rowId: string) => void
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
            <TableHead className="w-[14%] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row) => (
            <PluginSourceLine
              key={row.id}
              row={row}
              installState={isInstallRow(row) ? <PluginInstallBadge status={props.update} /> : null}
              override={props.override}
              onOpen={() => props.onOpen(row.id)}
              onOverride={() => props.onOverride(row.id)}
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
  override: string
  onOpen: () => void
  onOverride: () => void
}) {
  const row = props.row
  const switchable = canOverride(row) && row.exists
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
        <IdentifierText className="text-muted-foreground text-xs" text={row.path} />
        <SourceCopyCount row={row} />
      </TableCell>
      <TableCell className="align-top text-right whitespace-normal">
        <div className="flex flex-wrap justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          {switchable && (
            <Button size="sm" variant="outline" onClick={props.onOverride}>
              {isOverridden(row, props.override) ? "取消切换" : "切换"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={props.onOpen}>
            {isInstallRow(row) ? "管理…" : "详情…"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
