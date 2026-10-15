import { useState } from "react"

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Settings } from "@/lib/api"
import { readRecentProjects } from "@/lib/recent-projects"

/*
 * 新建对话：要读的工程目录与参考源在这一步定下来。
 * 工程目录跟着这条对话走，之后不在输入区来回改 —— 输入区只留「问什么」。
 */

export function ChatNewDialog(props: {
  settings: Settings | null
  onOpenChange: (open: boolean) => void
  onCreate: (projectRoot: string, templateId: string) => void
}) {
  // 调用方只在打开时挂载它，开与关归调用方；所以这里的初值就是「每次打开从什么起手」。
  const [projectRoot, setProjectRoot] = useState(() => readRecentProjects()[0] ?? "")
  const [templateId, setTemplateId] = useState(() => props.settings?.activeTemplateId ?? "")

  const recent = readRecentProjects()

  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建对话</DialogTitle>
          <DialogDescription>选这条对话要读的工程目录与参考源；工程目录定下来就跟着这条对话走。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-chat-project">工程目录</Label>
            <Input
              id="new-chat-project"
              list="new-chat-projects"
              spellCheck={false}
              className="font-mono text-xs"
              placeholder="工程目录的绝对路径（留空就只聊、不读代码）"
              value={projectRoot}
              onChange={(event) => setProjectRoot(event.target.value)}
            />
            <datalist id="new-chat-projects">
              {recent.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            {recent.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {recent.slice(0, 4).map((item) => (
                  <Button key={item} size="sm" variant="outline" title={item} onClick={() => setProjectRoot(item)}>
                    {shortName(item)}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {props.settings && (
            <div className="flex flex-col gap-2">
              <Label>参考源</Label>
              <Select value={templateId || props.settings.activeTemplateId} onValueChange={setTemplateId}>
                <SelectTrigger title="这条对话用哪份参考源">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {props.settings.templates.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => props.onCreate(projectRoot.trim(), templateId)}>开始对话</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* 最近工程在按钮上只给最后一段目录名，整条路径放 title。 */
function shortName(projectRoot: string): string {
  const parts = projectRoot.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? projectRoot
}
