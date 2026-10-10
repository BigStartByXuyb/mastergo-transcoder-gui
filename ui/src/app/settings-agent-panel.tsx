import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { ClampText } from "@/app/clamp-text"
import { CodexCard } from "@/app/codex-card"
import { useValueRunner } from "@/app/use-action-runner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { AUTOMATION_LABEL } from "@/lib/task-form"
import { useSettings } from "@/lib/use-settings"

/*
 * Agent 这一页：写盘开关 + 自动化层级 + 引擎版本（这一页只管 agent 自己的事）。
 * 跑插件用的运行环境（Node / PowerShell 7）、插件（流水线）与程序自身的更新都在「更新」那一页。
 */
export function SettingsAgentPanel() {
  const { settings, failure, save } = useSettings()
  /*
   * 两个即时保存动作各自有个忙位（写盘 / 自动化层级），但骨架只有一份
   *（ui/src/app/use-action-runner.ts 的 useValueRunner）：置忙 → 清旧错 → 跑 → 收尾，
   * 失败转成可读那句话也由它一处管。
   */
  const [saving, setSaving] = useState("")
  const [saveFailure, setSaveFailure] = useState("")
  const run = useValueRunner({ setWorking: setSaving, setFailure: setSaveFailure })

  /* 写盘开关是即时生效的单个布尔，不走「保存」按钮。 */
  async function toggleWrite(checked: boolean) {
    const payload = await run("write", () => save({ agent: { allowWrite: checked } }))
    if (payload) toast.success(checked ? "已允许 agent 改工程文件" : "已恢复只读")
  }

  /* 自动化层级同样是即时生效的单个值，不走「保存」按钮。它是全局的：所有页与所有任务的停点都按它走。 */
  async function changeAutomation(value: string) {
    await run("automation", () => save({ automation: value }))
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>自动化层级</CardTitle>
          <CardDescription>
            全局：所有页面与所有任务的停点都按它走。层级越低，越不会自己往前跑。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="automation">停点怎么办</Label>
            <Select
              value={settings?.automation ?? "assist"}
              onValueChange={(value) => void changeAutomation(value)}
              disabled={saving !== ""}
            >
              <SelectTrigger id="automation" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{AUTOMATION_LABEL.off}</SelectItem>
                <SelectItem value="assist">{AUTOMATION_LABEL.assist}</SelectItem>
                <SelectItem value="auto">{AUTOMATION_LABEL.auto}</SelectItem>
              </SelectContent>
            </Select>
            {saving === "automation" && <Loader2 className="size-3 animate-spin" />}
          </div>
          <p className="text-muted-foreground text-xs">
            「辅助」自动出候选、你确认后继续；「自动」出完候选直接续跑（看板任务由客户端自己补，不必开着这个页面）。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent 写盘</CardTitle>
          <CardDescription>关着时它只能读；开着才允许它在「对话」里直接改工程文件。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={Boolean(settings?.agent.allowWrite)} onCheckedChange={(checked) => void toggleWrite(checked)} />
            允许 agent 直接改工程文件
            {saving === "write" && <Loader2 className="size-3 animate-spin" />}
          </label>
          <p className="text-muted-foreground text-xs">
            关着时它也能帮你读代码、看日志、给方案，只是不去改文件。
          </p>
          {(failure || saveFailure) && (
            <Alert variant="destructive">
              <AlertTitle>出错了</AlertTitle>
              <AlertDescription>
                <ClampText text={saveFailure || failure} />
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <CodexCard />
    </div>
  )
}
