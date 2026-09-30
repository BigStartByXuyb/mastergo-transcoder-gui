import { useEffect, useState } from "react"
import { Download, Loader2, RefreshCw, RotateCcw, Rocket } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ClampText } from "@/app/clamp-text"
import { Progress } from "@/components/ui/progress"
import { api, type UpdateStatus } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import {
  canSwitch,
  describeAvailable,
  describeTask,
  describeUpdate,
  isDownloading,
  taskPercent,
  versionList
} from "@/lib/update-state"

const IDLE_POLL_MS = 15000
const WORKING_POLL_MS = 1500

function Notes(props: { lines: string[]; empty?: string }) {
  if (props.lines.length === 0) {
    return props.empty ? <p className="text-muted-foreground text-xs">{props.empty}</p> : null
  }
  return (
    <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4 text-xs">
      {props.lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  )
}

/*
 * 程序自身这一条版本线：检查 → 下载（只下变了的）→ 下次启动生效 → 回退。
 * 切换只改指针，正在跑的进程不被抽走文件，所以切完必须重启客户端才生效。
 */
export function UpdateCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [probe, setProbe] = useState("")
  const [failure, setFailure] = useState("")
  const [working, setWorking] = useState("")

  const transferring = status ? isDownloading(status.task) : false

  useEffect(() => {
    let stopped = false

    async function tick() {
      try {
        const payload = await api.updateStatus()
        if (stopped) return
        setStatus(payload.status)
        setProbe("")
      } catch (error) {
        if (stopped) return
        setProbe(describeFailure(error))
      }
    }

    void tick()
    const timer = window.setInterval(tick, transferring ? WORKING_POLL_MS : IDLE_POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [transferring])

  // 后端只管版本线与文件，界面只做两件事：把结果贴回来，失败就说原因。
  async function act(key: string, run: () => Promise<{ status: UpdateStatus }>, done = "") {
    setWorking(key)
    setFailure("")
    try {
      const payload = await run()
      setStatus(payload.status)
      if (done) toast.success(done)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setWorking("")
    }
  }

  async function download() {
    setWorking("download")
    setFailure("")
    try {
      const payload = await api.updateDownload()
      setStatus(payload.status)
      if (!payload.started) toast.info(payload.note)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setWorking("")
    }
  }

  const summary = describeUpdate(status)
  const available = status ? describeAvailable(status) : ""
  const taskText = status ? describeTask(status.task) : ""
  const busy = Boolean(status && status.busy)
  const canDownload = Boolean(
    status && status.state === "update_available" && status.available && !status.available.blocked && !working
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>程序更新</CardTitle>
        <CardDescription>
          更新的是这个客户端自己（界面 + 编排 + 引擎集成），不含插件 ——
          插件在「AI Agent」那一页按自己的版本走。只比对运行树里变了的文件，
          整版落在安装目录的 versions 下；切版本只改指针，随时能退回去。
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Badge variant={summary.tone}>{summary.label}</Badge>
          {status && <span className="text-muted-foreground text-xs">{status.repo}</span>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {summary.note && <p className="text-muted-foreground text-sm">{summary.note}</p>}
        {available && <p className="text-sm">{available}</p>}

        {/* 现在这一版是什么功能；下面那张表逐版列改了什么，回退时也能看出退回去少了什么。 */}
        {status && (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="text-xs font-medium">v{status.current} 这一版</p>
            <Notes lines={status.currentNotes} empty="这一版没有留下说明。" />
          </div>
        )}

        {transferring && status && (
          <div className="flex flex-col gap-2">
            <Progress value={taskPercent(status.task)} />
            <p className="text-muted-foreground text-xs">{taskText}</p>
          </div>
        )}

        {busy && (
          <Alert>
            <AlertTitle>有任务在跑</AlertTitle>
            <AlertDescription>{status?.busy}；跑完才能切版本。</AlertDescription>
          </Alert>
        )}

        {probe && (
          <Alert variant="destructive">
            <AlertTitle>读不到更新状态</AlertTitle>
            <AlertDescription>
              <ClampText text={probe} />
            </AlertDescription>
          </Alert>
        )}

        {failure && (
          <Alert variant="destructive">
            <AlertTitle>出错了</AlertTitle>
            <AlertDescription>
              <ClampText text={failure} />
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={Boolean(working)} onClick={() => void act("check", () => api.updateCheck())}>
            {working === "check" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            检查更新
          </Button>
          {canDownload && (
            <Button disabled={Boolean(working)} onClick={() => void download()}>
              {working === "download" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              下载 v{status?.available?.version}
            </Button>
          )}
          {status && status.ready && (
            <Button
              disabled={Boolean(working) || !canSwitch(status)}
              onClick={() => void act("apply", () => api.updateApply(), "已切到 v" + status.ready + "，下次启动生效")}
            >
              {working === "apply" ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
              重启后用 v{status.ready}
            </Button>
          )}
          {status && status.rollback && (
            <Button
              variant="outline"
              disabled={Boolean(working) || busy}
              onClick={() =>
                void act("rollback", () => api.updateRollback(), "已退回 v" + (status?.rollback ?? "") + "，下次启动生效")
              }
            >
              {working === "rollback" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
              退回 v{status.rollback}
            </Button>
          )}
        </div>

        {/* 逐版列改了什么：装了哪几版、远端那一版，同一个版本号只出一行。 */}
        {status && versionList(status).length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">版本</p>
            {versionList(status).map((item) => (
              <div key={item.version} className="flex flex-col gap-1 border-b pb-2 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-20 tabular-nums">v{item.version}</span>
                  {item.current && <Badge variant="secondary">正在用</Badge>}
                  {!item.current && item.installed && item.ready && <Badge variant="outline">可切换</Badge>}
                  {/* 比现在新的那一版还没拉下来不是「坏了」，别拿「文件不全」吓人。 */}
                  {!item.current && !item.ready && item.remote && <Badge variant="outline">有新版</Badge>}
                  {!item.current && !item.ready && !item.remote && item.installed && (
                    <Badge variant="destructive">文件不全</Badge>
                  )}
                  {item.date && <span className="text-muted-foreground text-xs">{item.date}</span>}
                  {!item.current && item.installed && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(working) || !canSwitch(status, item.version)}
                      onClick={() =>
                        void act(
                          "switch:" + item.version,
                          () => api.updateApply(item.version),
                          "已切到 v" + item.version + "，下次启动生效"
                        )
                      }
                    >
                      切到这一版
                    </Button>
                  )}
                </div>
                <Notes lines={item.notes} empty="这一版没有留下说明。" />
              </div>
            ))}
          </div>
        )}

        {status && status.pointer && status.pointer.version && status.pointer.version !== status.current && (
          <p className="text-muted-foreground text-xs">
            下次启动会跑 v{status.pointer.version}；现在这个窗口还是 v{status.current}。
          </p>
        )}
      </CardContent>
    </Card>
  )
}
