import { useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { PixelLoader } from "@/app/pixel-loader"
import { ChosenSlot } from "@/app/plugin-chosen-slot"
import { LookupOrder } from "@/app/plugin-order-bar"
import { PluginSourceDialog } from "@/app/plugin-source-dialog"
import { SourceAlsoFrom, SourceCopyCount, SourceStatusBadge, SourceVersion } from "@/app/plugin-source-facts"
import { SourceDialog } from "@/app/source-dialog"
import { UpdateSourceRow } from "@/app/update-source-row"
import { usePluginSources } from "@/app/use-plugin-sources"
import { usePluginUpdate } from "@/app/use-plugin-update"
import { describePluginInstall } from "@/lib/plugin-install"
import { busyNow } from "@/lib/update-state"
import {
  CHOSEN_SLOT_ID,
  INSTALL_SLOT_ID,
  PLUGIN_BUSY,
  canChooseThis,
  chooseKeyOf,
  choosePathOf,
  pluginLookup,
  type PluginSourceRow
} from "@/lib/plugin-sources"

// 插件：转码引擎来自 mastergo-wpf-transcoder 插件，客户端不自带引擎。
//
// 这一页只说三件事，各占一处，不重复：
//   找一个目录   —— 「我指定的那一份」（清掉＝回到按顺序自动）
//   按什么顺序找 —— 上面那条顺序，每一档都列出来（后端给的顺序，界面不重排）
//   每一档是什么 —— 一张表：来源 / 版本 / 状态 / 路径 / 操作；点开某一行是那一档的详情，
//                  点开「客户端自带」那一行是它的管理（检查更新 / 下载并安装 / 进度）。
// 另外一块：客户端自带那一份从哪儿取（更新来源：GitHub / GitLab / 静态目录）——
// 与「程序更新」是同一处设置、同一个弹窗，改完两边都按新的走。
//
// 取数分两半，各有各的 hook：来源清单与指针动作（use-plugin-sources）、
// 自带那一份的更新与轮询（use-plugin-update）；本组件只编排与渲染。
export function PluginCard() {
  const [opened, setOpened] = useState("")
  const [editingSource, setEditingSource] = useState(false)
  const sources = usePluginSources()
  const update = usePluginUpdate(() => void sources.load())

  const lookup = sources.view ? pluginLookup(sources.view.sources) : { slots: [], rows: [] }
  const selected = lookup.rows.find((row) => row.id === opened) ?? null
  /*
   * 「我指定的那一份」那一刻的处境：读后端那条结论（slots 里这一档的 active / exists），与表、顺序条同一份。
   * 不能只看「设置里有没有值」——那份插件可能已经不在那个目录了，这时候生效的是后面某一档。
   */
  const chosenSlot = lookup.slots.find((slot) => slot.id === CHOSEN_SLOT_ID) ?? null
  /*
   * 有任一半在跑、后端有任务、或正在传，就冻住「换一份 / 改发布源」这类动作：判据是 lib/update-state
   * 的 busyNow（与「程序更新」那张卡同一处）。这里只把这一页的三路忙位摆出来 ——
   * 「哪一半的哪个动作在跑」仍由各自那一半的 busy 字符串回答，不合成成同一个字符串再比对。
   */
  const frozen = busyNow([
    { busy: sources.busy },
    { busy: update.busy, transferring: update.transferring },
    { busy: update.update ? update.update.busy : "" }
  ])

  return (
    <Card>
      <CardHeader>
        <CardTitle>插件</CardTitle>
        <CardDescription>
          转码引擎来自插件；下面这张表就是客户端找插件的顺序，用的是标「正在用」的那一份。
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
            {/* 「我指定的那一份」只有这一处入口：换目录、或清掉回到按顺序自动。 */}
            <ChosenSlot
              chosen={sources.view.chosen}
              slot={chosenSlot}
              busy={sources.busy}
              frozen={frozen}
              onPick={() => void sources.pickFolder()}
              onAuto={() => void sources.choose("", PLUGIN_BUSY.auto)}
            />

            {/*
              自带那一份从哪儿取：与程序更新同一处设置（后端 lib/source.js 一处拼地址），
              这里也显示、也能改 —— 「GitHub / GitLab 在哪儿配」不能只有程序更新那一半看得见。
              「检查更新」与「管理…」面板里那颗是同一个动作（同一个函数、同一套禁用条件）。
            */}
            {update.update && (
              <div className="flex flex-col gap-2">
                <UpdateSourceRow
                  source={update.update.source}
                  hasToken={update.update.hasToken}
                  disabled={frozen}
                  onEdit={() => setEditingSource(true)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!update.canCheck}
                    aria-busy={update.busy === PLUGIN_BUSY.check}
                    onClick={() => void update.check()}
                  >
                    {update.busy === PLUGIN_BUSY.check ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    检查更新
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    要装哪一版，点表里「客户端自带」那一行的「管理…」
                  </span>
                </div>
              </div>
            )}

            {/* 查找顺序：每一档一句话，谁在生效、谁没有、哪两档是同一份，一眼看完。 */}
            <LookupOrder slots={lookup.slots} onOpen={(id) => setOpened(id)} />

            {/* 表：与顺序一一对应（同一份插件只列一行），点开某一行是那一档的详情 / 管理。 */}
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
                  {lookup.rows.map((row) => (
                    <PluginSourceLine
                      key={row.id}
                      row={row}
                      installState={row.members.includes(INSTALL_SLOT_ID) && update.update ? describePluginInstall(update.update).label : ""}
                      busy={sources.busy}
                      frozen={frozen}
                      onOpen={() => setOpened(row.id)}
                      // 行内「用这份」与面板里那颗同一口径（判据与记哪个目录都在 lib/plugin-sources）。
                      onChoose={() => void sources.choose(choosePathOf(row), chooseKeyOf(row))}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* 两半各自的失败：来源清单那一半与自带那份那一半，谁出事谁说话。 */}
            {update.failure && <span className="text-destructive text-xs">{update.failure}</span>}
            {update.probe && <span className="text-destructive text-xs">{update.probe}</span>}
          </>
        )}

        {editingSource && update.update && (
          <SourceDialog
            subject="插件（流水线）"
            view={{ source: update.update.source, hasToken: update.update.hasToken }}
            onClose={() => setEditingSource(false)}
            reload={async () => {
              const latest = await update.refresh()
              return { source: latest.source, hasToken: latest.hasToken }
            }}
            check={update.check}
          />
        )}

        {selected && (
          <PluginSourceDialog
            row={selected}
            update={selected.members.includes(INSTALL_SLOT_ID) ? update.update : null}
            busy={sources.busy}
            updateBusy={update.busy}
            frozen={frozen}
            transferring={update.transferring}
            canCheck={update.canCheck}
            onClose={() => setOpened("")}
            onChoose={(path, key) => void sources.choose(path, key)}
            onCheck={() => void update.check()}
            onInstall={() => void update.install()}
          />
        )}
      </CardContent>
    </Card>
  )
}

// 表里的一行：来源 / 版本 / 状态 / 路径 / 操作。
// 自带那一行还带一句它自己的更新状态（有新版 / 是最新 / 未检查 / 检查失败），表里就能看见要不要去管。
function PluginSourceLine(props: {
  row: PluginSourceRow
  installState: string
  /** 来源清单那一半的忙碌位：只有拿它比行 id 才是「这一行自己的动作在跑」。 */
  busy: string
  /** 哪一半在跑都算忙：忙的时候不给换一份（会顶掉正在跑的那一份）。 */
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
            <Button size="sm" variant="outline" disabled={props.frozen} onClick={props.onChoose}>
              {props.busy === chooseKeyOf(row) && <Loader2 className="size-4 animate-spin" />}
              用这份
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={props.onOpen}>
            {row.members.includes(INSTALL_SLOT_ID) ? "管理…" : "详情…"}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
