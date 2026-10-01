import { useMemo, useState } from "react"
import { Copy, Play, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ClampText } from "@/app/clamp-text"
import { EffectiveToggle } from "@/app/effective-toggle"
import { IdentifierText } from "@/app/identifier-text"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"
import { areaLabel, type AreaEntry } from "@/lib/areas"
import { readOnlyEffective, writeOnlyEffective } from "@/lib/board-form"
import { boardStateVariant } from "@/lib/board-state"
import { coverageOf, visibleByCoverage } from "@/lib/board-effective"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 区域详情：一个「工程 + 区域」底下有什么。
 *   页面：来自工程登记表（插件自己的口径），只读；
 *   任务：这一区域跑过/正在跑的任务，点「详情」进那条任务的 12 步与日志。
 *        同一页面只留当前生效那一行（与看板同一口径），被后一次合并覆盖的默认藏起来；
 *   两个动作：「复制区域模板」去新建任务（回填工程 + 区域）、「清空任务」只清这一区域的任务。
 * 清空不动工程登记表 —— 那是工程自己的文件，删条会影响这一页后续运行。
 */

type Props = {
  area: AreaEntry
  onOpenTask: (taskId: string) => void
  onNewTask: () => void
  onChanged: () => void
}

export function AreaPage(props: Props) {
  const { area } = props
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  // 与看板共用一份记忆：这一页只写这个开关，不动创建任务那张表单。
  const [onlyEffective, setOnlyEffective] = useState(readOnlyEffective)

  function changeOnlyEffective(value: boolean) {
    setOnlyEffective(value)
    writeOnlyEffective(value)
  }

  /* 生效/被覆盖一律按「本页最后一次合并成功的那一单」判，与看板共用 coverageOf，界面不另算一套。 */
  const coverage = useMemo(() => coverageOf(area.tasks), [area.tasks])
  const { shown: shownTasks, hidden: hiddenCount } = visibleByCoverage(area.tasks, coverage, onlyEffective)

  function clearTasks() {
    const count = area.tasks.length
    setBusy("clear")
    setFailure("")
    api
      .boardClearArea(area.projectRoot, area.ui)
      .then(() => {
        props.onChanged()
        toast.success("已清空这一区域的 " + count + " 条任务")
      })
      .catch((error) => setFailure(describeFailure(error)))
      .finally(() => setBusy(""))
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            区域 {areaLabel(area.ui)}
            <Badge variant="outline">任务 {area.tasks.length}</Badge>
            {area.running > 0 && <Badge variant="default">{area.running} 个跑着</Badge>}
          </CardTitle>
          <CardDescription>
            <IdentifierText text={area.projectRoot} />
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button size="sm" onClick={props.onNewTask}>
              <Copy className="size-4" />
              复制区域模板并新建任务
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== "" || area.tasks.length === 0 || area.running > 0}
              title={area.running > 0 ? "有任务还在跑，先停掉再清空" : ""}
              onClick={clearTasks}
            >
              <Trash2 className="size-4" />
              清空这一区域的任务
            </Button>
            <span className="text-muted-foreground text-xs">
              清空只动任务列表，不改工程的 docs/page-registry.json。
            </span>
          </div>
        </CardHeader>
        {failure && (
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>清空失败</AlertTitle>
              <AlertDescription>
                <ClampText text={failure} />
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>这一区域的页面</CardTitle>
          <CardDescription>来自工程的 docs/page-registry.json（插件自己的口径）：哪一页属于哪个区域。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {area.pages.length === 0 && (
            <p className="text-muted-foreground text-sm">
              登记表里还没有这个区域的页面。跑一次、或在新建任务里补一次区域，就会写进登记表。
            </p>
          )}
          {area.pages.map((page) => (
            <div key={page.target + page.layerId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{page.target}</span>
              {page.layerId && <span className="text-muted-foreground font-mono text-xs">{page.layerId}</span>}
              {page.designPageName && <span className="text-muted-foreground text-xs">设计页名 {page.designPageName}</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>这一区域的任务</CardTitle>
          <CardDescription>点「详情」看这条任务的 12 步、待确认与日志。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {area.tasks.length === 0 && <p className="text-muted-foreground text-sm">这个区域还没有任务。</p>}
          {area.tasks.length > 0 && (
            <div className="flex justify-end">
              <EffectiveToggle
                id="area-only-effective"
                checked={onlyEffective}
                hidden={hiddenCount}
                onChange={changeOnlyEffective}
              />
            </div>
          )}
          {shownTasks.map((task) => {
            const done = task.steps.filter((step) => step.status === "ok").length
            const state = coverage.get(task.id)
            /* 列宽写死：页面名再长也只在自己那一格里换行，不把整行撑宽。 */
            return (
              <div
                key={task.id}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem_4.5rem_auto] items-center gap-2 text-sm"
              >
                <div className="flex flex-col items-start gap-1">
                  <Badge variant={boardStateVariant(task.state)}>{task.stateLabel}</Badge>
                  {state === "effective" && <Badge variant="outline">生效中</Badge>}
                  {state === "covered" && (
                    <Badge variant="secondary" title="同一页面的后一次合并已经把它覆盖，工程里当前不是这一份">
                      已被覆盖
                    </Badge>
                  )}
                </div>
                <span className="min-w-0 font-medium break-all">{task.request.target || "（未定 Target）"}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {task.request.mode} · {done}/{task.steps.length || 12}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">{task.updatedAt.slice(11, 19)}</span>
                <Button size="sm" variant="outline" onClick={() => props.onOpenTask(task.id)}>
                  <Play className="size-3.5" />
                  详情
                </Button>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
