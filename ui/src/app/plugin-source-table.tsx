import { Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { IdentifierText } from "@/app/identifier-text"
import { SourceAlsoFrom, SourceCopyCount, SourceStatusBadge, SourceVersion } from "@/app/plugin-source-facts"
import { describePluginInstall } from "@/lib/plugin-install"
import {
  isInstallRow,
  canChooseThis,
  chooseKeyOf,
  type PluginSourceRow
} from "@/lib/plugin-sources"
import type { PluginUpdateStatus } from "@/lib/api"

/*
 * 来源表：来源 / 版本 / 状态 / 路径 / 操作。与上面那条查找顺序一一对应（同一份插件只列一行）。
 * 「自带那一行」还带一句它自己的更新状态（有新版 / 是最新 / 未检查 / 检查失败），表里就能看见要不要去管。
 */

export function PluginSourceTable(props: {
  rows: PluginSourceRow[]
  /** 自带那一份的状态（这一行里没有自带的也能传，只是不加那句更新状态）。 */
  update: PluginUpdateStatus | null
  /** 来源清单那一半的忙碌位：只有拿它比行 id 才是「这一行自己的动作在跑」。 */
  busy: string
  /** 哪一半在跑都算忙：忙的时候不给换一份。 */
  frozen: boolean
  onOpen: (rowId: string) => void
  /** 换一份：记这一档所在的目录（记哪个由 lib/plugin-sources 的 choosePathOf 说）。 */
  onChoose: (row: PluginSourceRow) => void
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[24%]">来源</TableHead>
            <TableHead className="w-[14%]">版本</TableHead>
            <TableHead className="w-[15%]">状态</TableHead>
            <TableHead>路径</TableHead>
            <TableHead className="w-[22%] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row) => (
            <PluginSourceLine
              key={row.id}
              row={row}
              installState={
                isInstallRow(row) && props.update ? describePluginInstall(props.update).label : ""
              }
              busy={props.busy}
              frozen={props.frozen}
              onOpen={() => props.onOpen(row.id)}
              onChoose={() => props.onChoose(row)}
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
  installState: string
  busy: string
  frozen: boolean
  onOpen: () => void
  onChoose: () => void
}) {
  const row = props.row

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
        <SourceStatusBadge row={row} />
        {props.installState && (
          <span className="block pt-1">
            <Badge variant="secondary">{props.installState}</Badge>
          </span>
        )}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <IdentifierText className="text-muted-foreground text-xs" text={row.path} />
        <SourceCopyCount row={row} />
      </TableCell>
      <TableCell className="align-top text-right whitespace-normal">
        <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          {canChooseThis(row) && (
            <Button
              size="sm"
              variant="outline"
              disabled={props.frozen}
              aria-busy={props.busy === chooseKeyOf(row)}
              onClick={props.onChoose}
            >
              {props.busy === chooseKeyOf(row) && <Loader2 className="size-4 animate-spin" />}
              用这份
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
