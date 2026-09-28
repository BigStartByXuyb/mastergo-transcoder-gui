import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ApiFailure, api, type PipelineStep, type PluginSummary } from "@/lib/api"

/*
 * 流水线页：直接展示插件给出的步骤契约。
 * 步骤清单不写死在界面里——插件增删步骤时这里跟着变。
 */
export function PipelinePage() {
  const [plugin, setPlugin] = useState<PluginSummary | null>(null)
  const [steps, setSteps] = useState<PipelineStep[]>([])
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    setFailure("")
    try {
      const payload = await api.plugin()
      setPlugin(payload.plugin)
      setSteps(payload.steps)
    } catch (error) {
      setFailure(error instanceof ApiFailure ? error.message + (error.hint ? "：" + error.hint : "") : String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>流水线契约</CardTitle>
          <CardDescription>
            直接从插件读取，界面不写死步骤。插件改了流程，这里跟着变。
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {plugin && <Badge variant="outline">插件 {plugin.version ? "v" + plugin.version : "未知版本"}</Badge>}
            {plugin && <Badge variant="secondary">共 {steps.length} 步</Badge>}
            {plugin && !plugin.runAllExists && <Badge variant="destructive">缺 run-all.ps1</Badge>}
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
              {loading && <Loader2 className="size-4 animate-spin" />}
              重新读取
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {failure && (
            <Alert variant="destructive">
              <AlertTitle>读不到流水线契约</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}

          {!failure &&
            steps.map((step) => {
              const open = expanded === step.Id
              return (
                <div key={step.Id} className="rounded-md border">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : step.Id)}
                    className="hover:bg-muted/50 flex w-full items-center gap-3 px-3 py-2 text-left"
                  >
                    {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                    <span className="text-muted-foreground w-6 shrink-0 text-xs">{step.Id}</span>
                    <span className="w-24 shrink-0 font-mono text-xs">{step.Name}</span>
                    <span className="text-sm">{step.Title}</span>
                  </button>
                  {open && (
                    <dl className="grid gap-3 border-t px-3 py-3 sm:grid-cols-2">
                      {(
                        [
                          ["输入", step.Inputs],
                          ["产出", step.Outputs],
                          ["失败", step.Failures],
                          ["怎么修", step.Recovery]
                        ] as const
                      ).map(([term, items]) => (
                        <div key={term}>
                          <dt className="text-muted-foreground text-xs">{term}</dt>
                          <dd>
                            <ul className="mt-1 list-disc pl-4 text-xs">
                              {items.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )
            })}

          {!failure && !loading && steps.length === 0 && (
            <p className="text-muted-foreground text-sm">插件没有返回步骤。</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
