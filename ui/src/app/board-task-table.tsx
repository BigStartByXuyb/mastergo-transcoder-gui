import { ChevronRight, GitMerge, Play, Square, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, type Board, type BoardTask } from "@/lib/api"
import { areaLabel, projectLabel } from "@/lib/areas"
import { boardStateVariant } from "@/lib/board-state"
import type { Coverage } from "@/lib/board-effective"
import { ClampText } from "@/app/clamp-text"
import { IdentifierText } from "@/app/identifier-text"
import { MergeConflicts } from "@/app/merge-conflicts"
import { canStop, isSettled } from "@/lib/task-state"

/*
 * 看板的任务表：任务页的主体，一页一条任务。
 * 状态、进度、失败原因都来自后端快照；冲突不猜，停下等人。
 *
 * 列宽按比例给：中间内容再长也只换行，不把整张表撑宽，窗口变窄时整表跟着缩。
 *
 * 工作区与 UI 各占一列：一台机器上会有多个工程、每个工程里又有 F1/F2 这些区域，
 * 只写 Target 会分不清这一条属于哪儿（筛选见 lib/board-filters.ts）。
 */
export function BoardTaskTable(props: {
  tasks: BoardTask[]
  coverage: Map<string, Coverage>
  busy: string
  onRun: (key: string, action: () => Promise<{ board: Board }>) => Promise<void>
  onCreate: () => void
  /** 这次是不是在筛（只算工作区/区域/状态这三条）。 */
  filtered: boolean
  /** 被「只看生效」藏起来的条数：空状态要说清是它藏的，别指向不存在的按钮。 */
  hiddenByEffective: number
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[10%]">状态</TableHead>
            <TableHead className="w-[11%]">工作区</TableHead>
            <TableHead className="w-[6%]">UI</TableHead>
            <TableHead className="w-[12%]">Target</TableHead>
            <TableHead className="w-[6%]">模式</TableHead>
            <TableHead className="w-[14%]">进度</TableHead>
            <TableHead>工作目录 / 说明</TableHead>
            <TableHead className="w-[14%] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              coverage={props.coverage.get(task.id)}
              busy={props.busy}
              run={props.onRun}
            />
          ))}
          {props.tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-10 text-center">
                <div className="flex flex-col items-center gap-2">
                  {props.filtered ? (
                    <>
                      <span className="text-muted-foreground text-sm">当前筛选下没有任务。</span>
                      <span className="text-muted-foreground text-xs">换个条件，或点上方的「清除筛选」。</span>
                    </>
                  ) : props.hiddenByEffective > 0 ? (
                    <>
                      <span className="text-muted-foreground text-sm">任务都被「只看生效」藏起来了。</span>
                      <span className="text-muted-foreground text-xs">
                        共 {props.hiddenByEffective} 条已被后一次合并覆盖；关掉上面那个开关就能看到。
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-muted-foreground text-sm">还没有任务。</span>
                      <Button size="sm" onClick={props.onCreate}>
                        创建任务
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function TaskRow({
  task,
  coverage,
  busy,
  run
}: {
  task: BoardTask
  coverage?: Coverage
  busy: string
  run: (key: string, action: () => Promise<{ board: Board }>) => Promise<void>
}) {
  const progress = task.progress
  const done = progress?.done ?? 0
  const total = progress?.total ?? 0
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  const blocked = busy !== ""

  return (
    <TableRow>
      <TableCell className="align-top whitespace-normal">
        <div className="flex flex-col items-start gap-1">
          <Badge variant={boardStateVariant(task.state)}>{task.stateLabel}</Badge>
          {coverage === "effective" && <Badge variant="outline">生效中</Badge>}
          {coverage === "covered" && (
            <Badge variant="secondary" title="同一页面的后一次合并已经把它覆盖，工程里当前不是这一份">
              已被覆盖
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top text-xs whitespace-normal">
        <span className="block truncate font-mono" title={task.request.projectRoot}>
          {projectLabel(task.request.projectRoot)}
        </span>
      </TableCell>
      <TableCell className="align-top">
        <Badge variant="outline">{areaLabel(task.request.ui)}</Badge>
      </TableCell>
      <TableCell className="align-top text-xs whitespace-normal">
        <IdentifierText text={task.request.target || "（按设计稿推导）"} />
      </TableCell>
      <TableCell className="align-top text-sm">{task.request.mode}</TableCell>
      <TableCell className="align-top">
        {progress ? (
          <div className="flex flex-col gap-1">
            <Progress value={percent} />
            <span className="text-muted-foreground block truncate text-xs" title={progress.currentTitle}>
              {done}/{total} {progress.currentTitle ? "· " + progress.currentTitle : ""}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <div className="flex flex-col gap-1">
          <ClampText
            text={task.workDir || task.request.projectRoot}
            lines={3}
            className="text-muted-foreground font-mono text-xs"
          />
          {task.error && <ClampText text={task.error} lines={2} className="text-destructive text-xs" />}
          {task.designImage && (
            <ClampText text={task.designImage} lines={2} className="text-muted-foreground text-xs" />
          )}
          {task.failure && task.failure.kind !== "semantic" && (
            <span className="text-destructive text-xs">
              <ClampText
                text={(task.failure.title || task.failure.stepName) + "：" + task.failure.message}
                lines={2}
              />
              {task.failure.logPath && (
                <IdentifierText text={task.failure.logPath} className="text-muted-foreground block" />
              )}
            </span>
          )}
          {task.failure && task.failure.kind === "semantic" && (
            <span className="text-muted-foreground text-xs">
              <ClampText
                text={
                  "停在语义判断点，不是错误：" +
                  (task.failure.title || task.failure.stepName) +
                  (task.failure.message ? " —— " + task.failure.message : "")
                }
                lines={2}
              />
            </span>
          )}
          {task.state === "waiting" && (
            <span className="text-muted-foreground text-xs">
              AI 会自动补输入；补不动就去「待确认」列表处理。
            </span>
          )}
          {task.merge && task.merge.conflicts.length === 0 && (
            <span className="text-muted-foreground text-xs">已合并 {task.merge.applied.length} 个文件</span>
          )}
          {task.merge && task.merge.conflicts.length > 0 && (
            <MergeConflicts
              conflicts={task.merge.conflicts}
              resolutions={task.resolutions}
              busy={blocked}
              onPick={(path, pick) => run(task.id + ":resolve:" + path, () => api.boardResolve(task.id, path, pick))}
            />
          )}
        </div>
      </TableCell>
      <TableCell className="align-top text-right whitespace-normal">
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.location.hash = "pipeline?task=" + task.id
            }}
          >
            <ChevronRight />
            详情
          </Button>
          {task.state === "queued" && (
            <Button size="sm" disabled={blocked} onClick={() => void run(task.id + ":start", () => api.boardStart(task.id))}>
              <Play /> 启动
            </Button>
          )}
          {canStop(task.state) && (
            <Button
              size="sm"
              variant="outline"
              disabled={blocked}
              onClick={() => void run(task.id + ":stop", () => api.boardStop(task.id))}
            >
              <Square /> 停止
            </Button>
          )}
          {(task.state === "ready" || task.state === "conflict") && (
            <Button size="sm" disabled={blocked} onClick={() => void run(task.id + ":merge", () => api.boardMerge(task.id))}>
              <GitMerge /> {task.state === "conflict" ? "重新合并" : "合并"}
            </Button>
          )}
          {isSettled(task.state) && (
            <Button
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => void run(task.id + ":remove", () => api.boardRemove(task.id))}
            >
              <Trash2 /> 移除
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
