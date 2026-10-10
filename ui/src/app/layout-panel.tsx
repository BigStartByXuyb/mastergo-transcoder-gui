import { Plus, Save, Sparkles, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useLayoutGroups, type LayoutGroupsInput } from "@/app/use-layout-groups"
import { addGroup, labelOf, moveMember, removeGroup, removeMember, ungroupedControls } from "@/lib/layout-edit"
import { useState } from "react"

/*
 * 作业A 的布局确认：把控件清单按「组 → 成员」展示，人/AI 调好分组后写回分组表。
 *
 * 控件按清单次序编号（#1 起）：界面上说编号，分组表里存的仍是 DSL ref，对应关系在 ui/src/lib/layout-edit.ts。
 * 取数、AI 候选与写回在 app/use-layout-groups.ts；写回校验的判据在后端 lib/layout-groups.js。
 *
 * 「自动通过」默认关：关着时这一块是必须确认的门禁；开着时由自动层级直接按 AI 候选 + 机械推导往下。
 */

type LayoutPanelProps = LayoutGroupsInput & {
  /** 现在能不能写回：任务已经停下来才给（跑着的时候续跑会起第二次运行）。 */
  confirmable: boolean
}

export function LayoutPanel({ confirmable, ...input }: LayoutPanelProps) {
  const layout = useLayoutGroups(input)
  const [newId, setNewId] = useState("")
  const [newKind, setNewKind] = useState<"column" | "row">("column")
  const ungrouped = ungroupedControls(layout.controls, layout.groups)

  function createGroup() {
    if (!newId.trim()) return
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
          控件按清单次序编号（#1 起）：把「同属一行或一列」的编号分成一组；分组表由布局推导消费。
          没有要声明的分组就直接确认（写出空表，按机械判据走）。成员太少、一个控件进多组这类毛病由后端判，
          写不进去时它会把原话显示在这里。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!layout.available && layout.reason ? (
          <p className="text-sm text-muted-foreground">{layout.reason}</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={layout.autoPass} onCheckedChange={(value) => void layout.toggleAutoPass(value)} id="layout-auto-pass" />
                <Label htmlFor="layout-auto-pass">自动通过</Label>
                <span className="text-xs text-muted-foreground">
                  （开着、且「设置 → AI Agent」的自动化层级不是「关」时才自动出分组）
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void layout.suggest()} disabled={layout.busy || !layout.canSuggest}>
                  <Sparkles className="mr-1 h-4 w-4" />
                  AI 辅助
                </Button>
                <Button size="sm" onClick={() => void layout.save()} disabled={layout.busy || !confirmable}>
                  <Save className="mr-1 h-4 w-4" />
                  {input.resume ? "写入分组表并继续" : "写入分组表"}
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
                任务正在跑：先在下面改好分组，等它停在布局确认（或停下来之后）再点
                {input.resume ? "「写入分组表并继续」" : "「写入分组表」"}。
              </p>
            ) : null}
            {layout.groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                没有要声明的分组就直接确认：写出空分组表，布局推导按机械判据走。
              </p>
            ) : null}

            <div className="space-y-3">
              {layout.groups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-md border p-3"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const ref = event.dataTransfer.getData("text/plain")
                    if (ref) layout.setGroups(moveMember(layout.groups, group.id, ref))
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{group.kind === "column" ? "列" : "行"}</Badge>
                      <span className="font-medium">{group.id}</span>
                      <span className="text-xs text-muted-foreground">{group.members.length} 个控件</span>
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
              <div className="mb-2 text-sm font-medium text-muted-foreground">未分组控件（{ungrouped.length}）</div>
              <div className="flex flex-wrap gap-1.5">
                {ungrouped.map((control) => (
                  <Badge
                    key={control.ref}
                    variant="outline"
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", control.ref)}
                  >
                    {labelOf(layout.controls, control.ref)}
                  </Badge>
                ))}
                {ungrouped.length === 0 ? <span className="text-xs text-muted-foreground">都分好组了</span> : null}
              </div>
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
                    <SelectItem value="column">列（竖直排）</SelectItem>
                    <SelectItem value="row">行（水平排）</SelectItem>
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
