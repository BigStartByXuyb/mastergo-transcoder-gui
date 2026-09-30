import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { ClampText } from "@/app/clamp-text"
import { CodexCard } from "@/app/codex-card"
import { RuntimeCard } from "@/app/runtime-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { describeFailure } from "@/lib/describe-failure"
import { useSettings } from "@/lib/use-settings"

/*
 * Agent 这一页：写盘开关 + 引擎版本线 + 跑插件用的运行环境。
 * 三样都决定「agent 能不能跑起来、能跑多大」，所以放一页；与程序自身的更新分开。
 */
export function SettingsAgentPanel() {
  const { settings, failure, save } = useSettings()
  const [writing, setWriting] = useState(false)
  const [saveFailure, setSaveFailure] = useState("")

  /* 写盘开关是即时生效的单个布尔，不走「保存」按钮。 */
  async function toggleWrite(checked: boolean) {
    setWriting(true)
    setSaveFailure("")
    try {
      await save({ agent: { allowWrite: checked } })
      toast.success(checked ? "已允许 agent 改工程文件" : "已恢复只读")
    } catch (error) {
      setSaveFailure(describeFailure(error))
    } finally {
      setWriting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Agent 写盘</CardTitle>
          <CardDescription>
            关着时只读；开着才允许它在「对话」里直接改工程文件。Windows 上 Codex 沙箱不放行只读命令，
            所以只读是给它的约定，不是系统隔离。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={Boolean(settings?.agent.allowWrite)} onCheckedChange={(checked) => void toggleWrite(checked)} />
            允许 agent 直接改工程文件
            {writing && <Loader2 className="size-3 animate-spin" />}
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

      <RuntimeCard />
    </div>
  )
}
