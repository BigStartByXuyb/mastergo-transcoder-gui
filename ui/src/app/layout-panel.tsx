import { useCallback, useEffect, useState } from "react"
import { Plus, Save, Sparkles, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useAlive } from "@/app/use-alive"
import { api, type BoardTask, type LayoutControl, type LayoutGroup, type LayoutGroups } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 作业A 的布局确认：把控件清单按「组 → 成员」展示，人/AI 调好分组后写回分组表。
 *
 * 数据与写盘口径都在后端 lib/layout-groups.js；AI 候选走 /api/ai/suggest 的 layout-groups。
 * 「自动通过」默认关：关着时这一块是必须确认的门禁；开着时由自动层级直接按 AI 候选 + 机械推导往下。
 */

function refKey(control: LayoutControl): string {
  return control.ref
}

function groupMembers(groups: LayoutGroup[]): Set<string> {
  const used = new Set<string>()
  for (const group of groups) for (const ref of group.members) used.add(ref)
  return used
}

export function LayoutPanel({ task }: { task: BoardTask }) {
  const projectRoot = task.workDir
  const target = task.request.target
  const [layout, setLayout] = useState<LayoutGroups | null>(null)
  const [groups, setGroups] = useState<LayoutGroup[]>([])
  const [autoPass, setAutoPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")
  const [newId, setNewId] = useState("")
  const [newKind, setNewKind] = useState<"column" | "row">("column")
  const alive = useAlive()

  const load = useCallback(async () => {
    if (!projectRoot || !target) return
    try {
      const [payload, settings] = await Promise.all([api.layoutGroups(projectRoot, target), api.settingsGet()])
      if (alive.current) {
        setLayout(payload.layout)
        setGroups(payload.layout.groups)
        setAutoPass(Boolean(settings.settings.layoutAutoPass))
      }
    } catch (error) {
      if (alive.current) setFailure(describeFailure(error))
    }
  }, [alive, projectRoot, target])

  useEffect(() => {
    void load()
  }, [load, task.updatedAt, task.progress?.done])

  function toggleAutoPass(value: boolean) {
    setAutoPass(value)
    api.settingsSave({ layoutAutoPass: value }).catch(() => {})
  }

  const controls = layout?.controls ?? []
  const used = groupMembers(groups)
  const ungrouped = controls.filter((control) => !used.has(refKey(control)))

  function addMember(groupId: string, ref: string) {
    setGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group
        if (group.members.includes(ref)) return group
        return { ...group, members: [...group.members, ref] }
      })
    )
  }

  function removeMember(groupId: string, ref: string) {
    setGroups((prev) =>
      prev.map((group) => (group.id === groupId ? { ...group, members: group.members.filter((m) => m !== ref) } : group))
    )
  }

  function addGroup() {
    const id = newId.trim()
    if (!id) return
    if (groups.some((group) => group.id === id)) {
      setFailure("组名重复：" + id)
      return
    }
    setGroups((prev) => [...prev, { id, kind: newKind, members: [] }])
    setNewId("")
  }

  function removeGroup(id: string) {
    setGroups((prev) => prev.filter((group) => group.id !== id))
  }

  async function suggest() {
    if (controls.length < 2) return
    setBusy(true)
    setFailure("")
    try {
      const payload = await api.aiLayoutGroups(controls)
      if (alive.current && payload.groups.length > 0) setGroups(payload.groups)
    } catch (error) {
      if (alive.current) setFailure(describeFailure(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    setFailure("")
    try {
      // 写回分组表并从 layout 续跑（写入只有 confirm 这一条路）。
      await api.confirm({ projectRoot, target, taskId: task.id, groups, resume: true })
    } catch (error) {
      if (alive.current) setFailure(describeFailure(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  function labelOf(control: LayoutControl): string {
    const text = control.text.trim()
    return text ? control.controlType + " · " + text : control.controlType
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          布局确认
          <Badge variant={layout?.available ? "secondary" : "outline"}>
            {layout?.available ? "可编辑" : "还没有控件清单"}
          </Badge>
        </CardTitle>
        <CardDescription>
          把「同属一行或一列」的控件分成一组；分组表由布局推导消费。自动通过默认关，开着时按 AI 候选直接往下。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!layout?.available && layout?.reason ? (
          <p className="text-sm text-muted-foreground">{layout.reason}</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={autoPass} onCheckedChange={toggleAutoPass} id="layout-auto-pass" />
                <Label htmlFor="layout-auto-pass">自动通过</Label>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={suggest} disabled={busy || controls.length < 2}>
                  <Sparkles className="mr-1 h-4 w-4" />
                  AI 辅助
                </Button>
                <Button size="sm" onClick={save} disabled={busy}>
                  <Save className="mr-1 h-4 w-4" />
                  确认并继续
                </Button>
              </div>
            </div>

            {failure ? <p className="text-sm text-destructive">{failure}</p> : null}

            <div className="space-y-3">
              {groups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-md border p-3"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const ref = event.dataTransfer.getData("text/plain")
                    if (ref) addMember(group.id, ref)
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{group.kind === "column" ? "列" : "行"}</Badge>
                      <span className="font-medium">{group.id}</span>
                      <span className="text-xs text-muted-foreground">{group.members.length} 个控件</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => removeGroup(group.id)}>
                      <Trash2 className="mr-1 h-3 w-3" />
                      删组
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {group.members.map((ref) => {
                      const control = controls.find((item) => item.ref === ref)
                      return (
                        <Badge key={ref} variant="secondary" className="gap-1">
                          {control ? labelOf(control) : ref}
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => removeMember(group.id, ref)}
                          >
                            ×
                          </button>
                        </Badge>
                      )
                    })}
                    {group.members.length === 0 ? (
                      <span className="text-xs text-muted-foreground">把控件拖进来</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-dashed p-3">
              <div className="mb-2 text-sm font-medium text-muted-foreground">未分组控件（{ungrouped.length}）</div>
              <div className="flex flex-wrap gap-1.5">
                {ungrouped.map((control) => (
                  <Badge
                    key={refKey(control)}
                    variant="outline"
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", control.ref)}
                  >
                    {labelOf(control)}
                  </Badge>
                ))}
                {ungrouped.length === 0 ? <span className="text-xs text-muted-foreground">都分好组了</span> : null}
              </div>
            </div>

            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="layout-group-id">新组名</Label>
                <Input id="layout-group-id" value={newId} onChange={(event) => setNewId(event.target.value)} placeholder="例如 RightTools" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="layout-group-kind">方向</Label>
                <select
                  id="layout-group-kind"
                  className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={newKind}
                  onChange={(event) => setNewKind(event.target.value as "column" | "row")}
                >
                  <option value="column">列（竖直排）</option>
                  <option value="row">行（水平排）</option>
                </select>
              </div>
              <Button variant="outline" onClick={addGroup} disabled={!newId.trim()}>
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
