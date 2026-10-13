import { Plus, Save, Sparkles, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { LayoutCanvas } from "@/app/layout-canvas"
import { LayoutTree } from "@/app/layout-tree"
import { useLayoutGroups, type LayoutGroupsInput } from "@/app/use-layout-groups"
import { api } from "@/lib/api"
import {
  addGroup,
  labelOf,
  moveMember,
  removeGroup,
  removeMember,
  treeLinesOf,
  ungroupedControls
} from "@/lib/layout-edit"
import { inFlightNote, isInFlight } from "@/lib/task-state"
import { cn } from "@/lib/utils"
import { useEffect, useState } from "react"

/*
 * 作业A 的布局确认：把控件清单按「组 → 成员」展示，人/AI 调好分组后写回分组表。
 *
 * 控件按清单次序编号（#1 起）：界面上说编号，分组表里存的仍是 DSL ref，对应关系在 ui/src/lib/layout-edit.ts。
 * 取数、AI 候选与写回在 app/use-layout-groups.ts；写回校验的判据在后端 lib/layout-groups.js。
 *
 * 「自动通过」默认关：关着时这一块是必须确认的门禁；开着时由自动层级直接按 AI 候选 + 机械推导往下。
 */

type LayoutPanelProps = LayoutGroupsInput & {
  /** 来源运行/任务的状态：跑着的时候不给写回（判据见 ui/src/lib/task-state.ts 的 isInFlight）。 */
  state: string
}

export function LayoutPanel({ state, ...input }: LayoutPanelProps) {
  const layout = useLayoutGroups(input)
  const confirmable = !isInFlight(state)
  /* 这一颗按钮的名字只有一处：提示语里说的也就是它（没有来源运行时是「写入分组表」，不续跑）。 */
  const writeLabel = input.resume ? "写入分组表并继续" : "写入分组表"
  const [newId, setNewId] = useState("")
  const [newKind, setNewKind] = useState<"column" | "row">("column")
  /* 鼠标停在哪一组上：那一组的成员在画布上描出来（容器自己的框就盖住它里面的控件）。 */
  const [hoveredGroup, setHoveredGroup] = useState("")
  /* 布局树上选中的那一行：只存 key（那一行盖住哪些控件按当前读数现算，不留上一次那一份）。 */
  const [treePicked, setTreePicked] = useState("")
  /* 换一页（工程目录或 Target 变了）就把树上选中的那一行清掉：同一页的身份是这两个一起。 */
  useEffect(() => setTreePicked(""), [input.projectRoot, input.target])
  /*
   * 分组表里能写的只有这一层的可引用条目（清单里那几条）：未分组控件按后端给的 `citable` 分成两拨 ——
   * 能拖进组的与不能写进表的（清单外，例如合成容器的 ref 或别层的控件）。这面标记是后端的结论，界面不自己再算。
   * 清单还没落下来时不分拨（那不等于「这些条目写不进去」）：面板只把后端那句原因说清，并关掉写回。
   */
  const ungrouped = ungroupedControls(layout.controls, layout.groups)
  const writable = layout.candidates.available ? ungrouped.filter((control) => control.citable) : []
  const outside = layout.candidates.available ? ungrouped.filter((control) => !control.citable) : []
  const hasCandidates = layout.candidates.available
  const canvas = layout.canvas
  const hovered = layout.groups.find((group) => group.id === hoveredGroup)?.members ?? []
  /* 选中那一行盖住的控件：与树同一处算法（treeLinesOf）算出来的那一行的 hit —— 读数刷新后跟着变。 */
  const treeRefs = treeLinesOf(layout.derived, layout.controls).find((line) => line.key === treePicked)?.hit ?? []
  const highlight = [...new Set([...treeRefs, ...hovered])]

  function createGroup() {
    layout.setGroups(addGroup(layout.groups, newId, newKind))
    setNewId("")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          布局确认
          <Badge variant={layout.available ? "secondary" : "outline"}>{layout.available ? "可编辑" : "还没有控件清单"}</Badge>
        </CardTitle>
        <CardDescription>
          这张「分组表」只写一件事：哪些控件同属一组、这个组往哪个方向排（垂直布局 / 水平布局）、它叫什么 ——
          布局推导按它走。
          带设计稿位图时流水线不替你猜分组：要么在这里声明分组，要么写一张空表说明「本页没有要声明的分组」。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!layout.available && layout.reason ? (
          <p className="text-sm text-muted-foreground">{layout.reason}</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  checked={layout.autoPass}
                  disabled={layout.busy}
                  onCheckedChange={(value) => void layout.toggleAutoPass(value)}
                  id="layout-auto-pass"
                />
                <Label htmlFor="layout-auto-pass">自动通过</Label>
                <span className="text-xs text-muted-foreground">
                  （全局：对所有页生效；自动化层级在「设置 → AI Agent」。没自动出分组时，下面会说清是哪一条没满足）
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void layout.suggest()} disabled={layout.busy || !layout.canSuggest}>
                  <Sparkles className="mr-1 h-4 w-4" />
                  AI 辅助
                </Button>
                <Button
                  size="sm"
                  onClick={() => void layout.save()}
                  disabled={layout.busy || !confirmable || !layout.candidates.available}
                >
                  <Save className="mr-1 h-4 w-4" />
                  {writeLabel}
                </Button>
              </div>
            </div>

            {layout.failure ? <p className="text-sm text-destructive">{layout.failure}</p> : null}
            {layout.note ? <p className="text-sm text-muted-foreground">{layout.note}</p> : null}
            {layout.saved ? (
              <p className="text-sm text-muted-foreground">
                {input.resume ? "已确认，正在从布局推导继续。" : "已写入分组表（这条没有来源运行，不续跑）。"}
              </p>
            ) : null}
            {!confirmable ? (
              <p className="text-sm text-muted-foreground">
                {inFlightNote(writeLabel)}
              </p>
            ) : null}
            {/* 这一层能写哪些 ref：清单不在就不给写（判据在后端 lib/layout-candidates.js，这里只照它说）。 */}
            {!layout.candidates.available ? (
              <p className="text-sm text-destructive">{layout.candidates.reason}</p>
            ) : layout.candidates.entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                这一层的条目清单是空的：这一层不参与分组，表里不声明任何组 —— 直接点「{writeLabel}」写出空表。
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                这一层的可引用条目（{layout.candidates.entries.length}）：分组表里的 ref 只能从这些条目里取。
              </p>
            )}
            {layout.groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                没有要声明的分组：直接点「{writeLabel}」，它写出空分组表，布局推导按机械判据走；
                要声明分组：先在下面起个组名、选方向（垂直布局 / 水平布局），再把控件拖进那个组里。
              </p>
            ) : null}

            {/*
             * 画布与布局树各自独立：画板尺寸还不知道时，布局树（推导结果）照样要能看。
             * 「有没有推导产物」只在 LayoutTree 里判（没有时它显示后端给的那句原因）——面板不再自己判一遍。
             */}
            <div className={cn("grid gap-3", canvas && "lg:grid-cols-[minmax(0,1fr)_16rem]")}>
              {canvas && (
                <LayoutCanvas
                  controls={layout.controls}
                  canvas={canvas}
                  /* 没有图就给空串：画布据此不挂图、也不给「隐藏设计稿」（图的身份由后端一处给）。 */
                  imageUrl={
                    layout.imageStamp ? api.designImageUrl(input.projectRoot, input.target, layout.imageStamp) : ""
                  }
                  highlight={highlight}
                />
              )}
              <LayoutTree
                derived={layout.derived}
                controls={layout.controls}
                selected={treePicked}
                onPick={(key) => setTreePicked(treePicked === key ? "" : key)}
              />
            </div>

            <div className="space-y-3">
              {layout.groups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-md border p-3"
                  onMouseEnter={() => setHoveredGroup(group.id)}
                  onMouseLeave={() => setHoveredGroup("")}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const ref = event.dataTransfer.getData("text/plain")
                    if (ref) layout.setGroups(moveMember(layout.groups, group.id, ref))
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {/* 人选的组方向与布局树上的方向同一套词：column = 上下排，row = 左右排。 */}
                      <Badge variant="outline">{group.kind === "column" ? "垂直布局" : "水平布局"}</Badge>
                      <span className="font-medium">{group.id}</span>
                      <span className="text-xs text-muted-foreground">{group.members.length} 个条目</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => layout.setGroups(removeGroup(layout.groups, group.id))}>
                      <Trash2 className="mr-1 h-3 w-3" />
                      删组
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.members.map((ref) => (
                      <Badge
                        key={ref}
                        variant="secondary"
                        className="gap-1"
                        draggable
                        onDragStart={(event) => event.dataTransfer.setData("text/plain", ref)}
                      >
                        {labelOf(layout.controls, ref)}
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => layout.setGroups(removeMember(layout.groups, group.id, ref))}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                    {group.members.length === 0 ? <span className="text-xs text-muted-foreground">把控件拖进来</span> : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-dashed p-3">
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-muted-foreground">未分组条目（{writable.length}）</span>
                <span className="text-xs text-muted-foreground">拖进上面某个组里（只有这一层的可引用条目能写进表）</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {writable.map((control) => (
                  <Badge
                    key={control.ref}
                    variant="outline"
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", control.ref)}
                  >
                    {labelOf(layout.controls, control.ref)}
                  </Badge>
                ))}
                {writable.length === 0 && outside.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {hasCandidates ? "都分好组了" : "清单落下来之后，这一层的条目才谈得上拖进组里"}
                  </span>
                ) : null}
                {writable.length === 0 && outside.length > 0 ? (
                  <span className="text-xs text-muted-foreground">这一层没有还能进组的条目</span>
                ) : null}
              </div>
              {/* 清单外的条目写不进表（插件那边也会拒）：列出来让人知道它们为什么拖不动。 */}
              {outside.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-baseline gap-2">
                  <span className="text-xs text-muted-foreground">
                    不在这一层条目里、不能写进分组表（{outside.length}）：
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {outside.map((control) => labelOf(layout.controls, control.ref)).join("、")}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="layout-group-id">新组名</Label>
                <Input
                  id="layout-group-id"
                  value={newId}
                  onChange={(event) => setNewId(event.target.value)}
                  placeholder="例如 RightTools"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="layout-group-kind">方向</Label>
                <Select value={newKind} onValueChange={(value) => setNewKind(value as "column" | "row")}>
                  <SelectTrigger id="layout-group-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="column">垂直布局（上下排）</SelectItem>
                    <SelectItem value="row">水平布局（左右排）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={createGroup} disabled={!newId.trim()}>
                <Plus className="mr-1 h-4 w-4" />
                新增组
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
