import { useState } from "react"
import { FolderSearch, Loader2, Plus, Save, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ClampText } from "@/app/clamp-text"
import { api, type CodebaseEntry, type PromptTemplate, type Settings } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { cn } from "@/lib/utils"

/*
 * 参考源：一份「代码库清单 + 系统提示词」，可以存多份；每条对话挑一份生效。
 * 界面上叫参考源，接口与落盘字段仍是 `templates` / `templateId`（见 lib/settings.js）。
 *
 * 是对话的子功能，所以从对话那页打开。左边挑参考源，右边改这一份的内容。
 */
export function TemplateDialog(props: {
  open: boolean
  settings: Settings
  onOpenChange: (open: boolean) => void
  onSaved: (settings: Settings) => void
  save: (patch: unknown) => Promise<Settings>
}) {
  const [rows, setRows] = useState<PromptTemplate[]>(props.settings.templates)
  const [activeId, setActiveId] = useState(props.settings.activeTemplateId)
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const [picking, setPicking] = useState("")

  const current = rows.find((item) => item.id === activeId) || rows[0]

  function patchTemplate(id: string, patch: Partial<PromptTemplate>) {
    setRows((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function patchCodebase(id: string, index: number, patch: Partial<CodebaseEntry>) {
    const target = rows.find((item) => item.id === id)
    if (!target) return
    const codebases = target.codebases.map((row, at) => (at === index ? { ...row, ...patch } : row))
    patchTemplate(id, { codebases })
  }

  async function browse(id: string, index: number) {
    setPicking(id + ":" + index)
    setFailure("")
    try {
      const picked = await api.pickFolder()
      if (picked.path) patchCodebase(id, index, { path: picked.path })
      else if (picked.reason) toast.info(picked.reason)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setPicking("")
    }
  }

  function addTemplate() {
    const id = "t" + Date.now().toString(36)
    setRows((list) => [...list, { id, name: "新参考源 " + (list.length + 1), systemPrompt: "", codebases: [] }])
    setActiveId(id)
  }

  async function submit() {
    setBusy("save")
    setFailure("")
    try {
      const saved = await props.save({ templates: rows, activeTemplateId: activeId })
      props.onSaved(saved)
      toast.success("已保存")
      props.onOpenChange(false)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[86svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>参考源</DialogTitle>
          <DialogDescription>
            一份参考源 = 一组代码库 + 一段系统提示词。可以存多份，每条对话挑一份生效（在对话页顶上选）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 sm:flex-row">
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-48">
            {rows.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                  item.id === activeId ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                )}
              >
                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setActiveId(item.id)}>
                  {item.name}
                </button>
                {rows.length > 1 && (
                  <button
                    type="button"
                    title="删掉这份参考源"
                    className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
                    onClick={() => {
                      const left = rows.filter((one) => one.id !== item.id)
                      setRows(left)
                      if (activeId === item.id) setActiveId(left[0].id)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addTemplate}>
              <Plus className="size-3.5" />
              新建参考源
            </Button>
          </div>

          {current && (
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="source-name">参考源名字</Label>
                <Input
                  id="source-name"
                  value={current.name}
                  onChange={(event) => patchTemplate(current.id, { name: event.target.value })}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>这份参考源里的代码库</Label>
                {current.codebases.length === 0 && (
                  <p className="text-muted-foreground text-sm">还没有。点「添加一个库」，填路径与它是什么库。</p>
                )}
                {current.codebases.map((row, index) => (
                  <div key={index} className="flex flex-col gap-2 rounded-md border p-2">
                    <div className="flex gap-2">
                      <Input
                        spellCheck={false}
                        className="font-mono text-xs"
                        placeholder="代码库路径（也可以点右边浏览…）"
                        value={row.path}
                        onChange={(event) => patchCodebase(current.id, index, { path: event.target.value })}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={picking !== ""}
                        onClick={() => void browse(current.id, index)}
                      >
                        {picking === current.id + ":" + index ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <FolderSearch className="size-3.5" />
                        )}
                        浏览…
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        spellCheck={false}
                        placeholder="是什么库（例如 MTSLG IOContorl 页面工程）"
                        value={row.name}
                        onChange={(event) => patchCodebase(current.id, index, { name: event.target.value })}
                      />
                      <Input
                        spellCheck={false}
                        placeholder="说明（可选）"
                        value={row.note}
                        onChange={(event) => patchCodebase(current.id, index, { note: event.target.value })}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={row.enabled}
                          onCheckedChange={(value) => patchCodebase(current.id, index, { enabled: value })}
                        />
                        这次也带上它
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          patchTemplate(current.id, { codebases: current.codebases.filter((_, at) => at !== index) })
                        }
                      >
                        <Trash2 className="size-3.5" />
                        删掉
                      </Button>
                    </div>
                  </div>
                ))}
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patchTemplate(current.id, {
                        codebases: [...current.codebases, { path: "", name: "", note: "", enabled: true }]
                      })
                    }
                  >
                    <Plus className="size-3.5" />
                    添加一个库
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label>系统提示词</Label>
                <Textarea
                  rows={4}
                  spellCheck={false}
                  placeholder="用这份参考源时，每次提问都会先给它看这一段。"
                  value={current.systemPrompt}
                  onChange={(event) => patchTemplate(current.id, { systemPrompt: event.target.value })}
                />
              </div>
            </div>
          )}
        </div>

        {failure && (
          <Alert variant="destructive">
            <AlertTitle>出错了</AlertTitle>
            <AlertDescription>
              <ClampText text={failure} />
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={busy !== ""} onClick={() => void submit()}>
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
