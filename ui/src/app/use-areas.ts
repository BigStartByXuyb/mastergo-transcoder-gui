import { useCallback, useEffect, useState } from "react"

import { api, type BoardTask } from "@/lib/api"
import { buildAreas, collectProjectRoots, type AreaEntry, type AreaPage } from "@/lib/areas"
import { forgetProject, readRecentProjects, rememberProject } from "@/lib/recent-projects"
import { POLL_MS } from "@/lib/task-state"

/*
 * 侧边栏要的两样数据：看板任务（谁在跑）与各工程的登记表（哪些区域、哪些页面）。
 *
 * 工程来源是「用过的工程目录」+ 任务里出现过的工程；登记表按工程各拉一次就缓存住，
 * 只有新工程才再请求。区域归并的口径在 lib/areas.ts（纯函数），这里只管取数与轮询。
 */
export function useAreas() {
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [pagesByProject, setPagesByProject] = useState<Record<string, AreaPage[]>>({})
  const [projects, setProjects] = useState<string[]>(() => readRecentProjects())
  // 深链进来时先别急着说「这个区域不存在」：看板还没回来之前只是「还没读到」。
  const [loaded, setLoaded] = useState(false)

  const loadBoard = useCallback(async () => {
    try {
      const payload = await api.board()
      setTasks(payload.board.tasks)
      // 任务里出现过的工程也算「用过」：任务列表与侧边栏用同一份记忆。
      const roots = collectProjectRoots(payload.board.tasks)
      const before = readRecentProjects().join("|")
      for (const root of roots) rememberProject(root)
      const after = readRecentProjects()
      if (after.join("|") !== before) setProjects(after)
    } catch {
      /* 轮询失败不打断界面：保留上一份快照 */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void loadBoard()
    const timer = window.setInterval(() => void loadBoard(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [loadBoard])

  useEffect(() => {
    const wanted = [
      ...new Set([
        ...projects,
        ...collectProjectRoots(tasks)
      ])
    ].filter((root) => !(root in pagesByProject))
    if (wanted.length === 0) return

    let alive = true
    void Promise.all(
      wanted.map((root) =>
        api
          .projectPages(root)
          .then((payload) => [root, payload.pages.pages] as const)
          .catch(() => [root, []] as const)
      )
    ).then((entries) => {
      if (!alive) return
      setPagesByProject((current) => {
        const next = { ...current }
        for (const [root, pages] of entries) {
          next[root] = pages.map((page) => ({
            target: page.target,
            ui: page.ui,
            layerId: page.layerId,
            designPageName: page.designPageName
          }))
        }
        return next
      })
    })
    return () => {
      alive = false
    }
  }, [projects, tasks, pagesByProject])

  /*
   * 任务账变了（新建一条、跑完、被清掉）就作废登记表缓存：新建任务时界面会把区域写进登记表，
   * 只缓存一次的话这一会话里就永远看不到新条目。任务账没变时不重拉（轮询 1.5s 一次，只比字符串）。
   */
  const taskSignature = tasks.map((task) => task.id + ":" + task.state).sort().join("|")
  useEffect(() => {
    setPagesByProject({})
  }, [taskSignature])

  const areas: AreaEntry[] = buildAreas({ projects: projects, pagesByProject: pagesByProject, tasks: tasks })

  /* 从侧边栏移除一个工程：只动本地记忆，不碰工程里的任何文件（界面只在它没有任务时才给这个入口）。 */
  function forget(projectRoot: string) {
    setProjects(forgetProject(projectRoot))
  }

  return { areas: areas, tasks: tasks, projects: projects, loaded: loaded, reload: loadBoard, forget: forget }
}
