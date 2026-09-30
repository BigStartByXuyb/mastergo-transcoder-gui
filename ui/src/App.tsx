import { useEffect, useState } from "react"
import { toast } from "sonner"

import { AppShell, TOOLS, type ToolKey } from "@/app/app-shell"
import { PixelLoader } from "@/app/pixel-loader"
import { AreaPage } from "@/app/area-page"
import { BoardPage } from "@/app/board-page"
import { ChatPage } from "@/app/chat-page"
import { MappingPage } from "@/app/mapping-page"
import { PipelinePage } from "@/app/pipeline-page"
import { QueryPage } from "@/app/query-page"
import { ReviewPage } from "@/app/review-page"
import { SettingsPage } from "@/app/settings-page"
import { useAreas } from "@/app/use-areas"
import { Badge } from "@/components/ui/badge"
import { areaKey, areaLabel } from "@/lib/areas"
import { useHealth } from "@/lib/use-health"
import { UpdateBadge } from "@/app/update-badge"

/*
 * 路由：`#<页面>?<查询串>`。
 *   #area?key=<工程>|<区域>    区域详情（侧边栏点进来的地方）
 *   #pipeline?task=<id>        某条任务的详情；带 project/ui 时同时当作「新建任务」的模板
 *   #board / #review / #query / #mapping / #settings   工具页
 */

const TOOL_KEYS = TOOLS.map((item) => item.key) as readonly string[]
const PAGE_KEYS = ["area", "pipeline", ...TOOL_KEYS] as readonly string[]

type Route = { page: string; params: URLSearchParams }

function readRoute(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "")
  const at = raw.indexOf("?")
  const key = at < 0 ? raw : raw.slice(0, at)
  return {
    page: PAGE_KEYS.includes(key) ? key : "board",
    params: new URLSearchParams(at < 0 ? "" : raw.slice(at + 1))
  }
}

function StatusBadges(props: { onOpenUpdatePage: () => void }) {
  const { health, offline } = useHealth()

  if (offline) return <Badge variant="destructive">服务未就绪</Badge>
  if (!health) return <Badge variant="outline">连接中…</Badge>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">v{health.version}</Badge>
      <Badge variant={health.plugin.engineExists ? "secondary" : "destructive"}>
        引擎{health.plugin.engineExists ? "就绪" : "缺失"}
      </Badge>
      <Badge variant="outline">插件 {health.plugin.version ? "v" + health.plugin.version : "未知版本"}</Badge>
      <UpdateBadge
        update={health.update ?? null}
        supervised={health.supervised}
        onOpenUpdatePage={props.onOpenUpdatePage}
      />
    </div>
  )
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  const areas = useAreas()

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute())
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  function go(hash: string) {
    window.location.hash = hash
    setRoute(readRoute())
  }

  const areaKeyParam = route.page === "area" || route.page === "pipeline" ? (route.params.get("key") ?? "") : ""
  const projectParam = route.params.get("project") ?? ""
  const uiParam = route.params.get("ui") ?? ""
  const activeKey = areaKeyParam || (projectParam ? areaKey(projectParam, uiParam) : "")
  const activeArea = areas.areas.find((area) => area.key === activeKey) ?? null
  const taskId = route.page === "pipeline" ? (route.params.get("task") ?? "") : ""

  const areaLabelText = activeArea ? activeArea.projectRoot + " · " + areaLabel(activeArea.ui) : ""
  const title =
    route.page === "area"
      ? areaLabelText || "区域"
      : route.page === "pipeline"
        ? taskId
          ? "任务详情" + (areaLabelText ? " · " + areaLabelText : "")
          : "新建转码任务" + (areaLabelText ? " · " + areaLabelText : "")
        : (TOOLS.find((item) => item.key === route.page)?.label ?? "")

  return (
    <AppShell
      areas={areas.areas}
      activeAreaKey={activeKey}
      activeTool={TOOL_KEYS.includes(route.page) ? (route.page as ToolKey) : null}
      title={title}
      status={<StatusBadges onOpenUpdatePage={() => go("settings?tab=update")} />}
      // 对话要「上方滚动 + 下方固定输入」，设置是两栏，两者都不限宽。
      wide={route.page === "chat" || route.page === "settings" || route.page === "board"}
      // 两个页面都撑满这一屏：页面自己不滚，长内容交给页面内的列表分页 / 内部滚动。
      fill={route.page === "chat" || route.page === "settings" || route.page === "board"}
      onGoTool={(key) => go(key)}
      onGoArea={(area) => go("area?key=" + encodeURIComponent(area.key))}
      onForgetProject={(projectRoot) => {
        if (!areas.forget(projectRoot)) toast.error("这个工程还有任务，先清空它的任务再移除")
      }}
      onNewTask={() => go(activeArea ? "pipeline?key=" + encodeURIComponent(activeArea.key) : "pipeline")}
    >
      {route.page === "area" &&
        (activeArea ? (
          <AreaPage
            area={activeArea}
            onOpenTask={(id) => go("pipeline?task=" + encodeURIComponent(id) + "&key=" + encodeURIComponent(activeArea.key))}
            onNewTask={() => go("pipeline?key=" + encodeURIComponent(activeArea.key))}
            onChanged={() => void areas.reload()}
          />
        ) : areas.loaded ? (
          <p className="text-muted-foreground text-sm">这个区域已经不在列表里了（任务被清掉或工程被移除）。</p>
        ) : (
          <PixelLoader text="请稍等，正在读取区域" className="py-6" />
        ))}
      {route.page === "pipeline" && (
        <PipelinePage
          taskId={taskId}
          initialArea={activeArea ? { projectRoot: activeArea.projectRoot, ui: activeArea.ui } : null}
        />
      )}
      {route.page === "board" && <BoardPage />}
      {route.page === "chat" && <ChatPage />}
      {route.page === "review" && <ReviewPage />}
      {route.page === "query" && <QueryPage />}
      {route.page === "mapping" && <MappingPage />}
      {route.page === "settings" && (
        <SettingsPage
          tab={route.params.get("tab") ?? ""}
          onPickTab={(tab) => go("settings?tab=" + tab)}
        />
      )}
    </AppShell>
  )
}
