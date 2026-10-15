import { useCallback, useEffect, useRef, useState } from "react"

import { api, type BoardTask } from "@/lib/api"
import {
  buildAreas,
  collectProjectRoots,
  projectHasTasks,
  projectRootOf,
  type AreaEntry,
  type AreaPage
} from "@/lib/areas"
import { forgetProject, readRecentProjects, rememberProject } from "@/lib/recent-projects"
import { POLL_MS } from "@/lib/task-state"

/*
 * 侧边栏要的两样数据：看板任务（谁在跑）与各工程的登记表（哪些区域、哪些页面）。
 *
 * 工程来源是「用过的工程目录」+ 任务里出现过的工程；登记表按工程各拉一次就缓存住。
 * 缓存失效按工程收窄：只有这个工程的任务账变了（新建 / 跑完 / 被清掉）才丢它自己那份 ——
 * 新建任务时界面会把区域写进登记表，缓存太久就看不到新条目；别的工程不跟着重拉。
 * 区域归并的口径在 lib/areas.ts（纯函数），这里只管取数与轮询。
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

  /* 每个工程的任务账（任务 id + 状态）：只有变了的工程才作废它自己的登记表缓存。 */
  const signatureByProject: Record<string, string> = {}
  for (const task of tasks) {
    const root = projectRootOf(task)
    if (!root) continue
    const entry = task.id + ":" + task.state
    signatureByProject[root] = signatureByProject[root] ? signatureByProject[root] + "," + entry : entry
  }
  const signatureKey = Object.keys(signatureByProject)
    .sort()
    .map((root) => root + "=" + signatureByProject[root])
    .join("|")
  const seenSignature = useRef<Record<string, string>>({})
  useEffect(() => {
    const changed = new Set<string>()
    for (const [root, signature] of Object.entries(signatureByProject)) {
      if (seenSignature.current[root] !== signature) changed.add(root)
    }
    for (const root of Object.keys(seenSignature.current)) {
      if (!(root in signatureByProject)) changed.add(root)
    }
    seenSignature.current = signatureByProject
    if (changed.size === 0) return
    setPagesByProject((current) => {
      const next = { ...current }
      for (const root of changed) delete next[root]
      return next
    })
  }, [signatureKey])

  const areas: AreaEntry[] = buildAreas({ projects: projects, pagesByProject: pagesByProject, tasks: tasks })

  /*
   * 从侧边栏移除一个工程：只动本地记忆，不碰工程里的任何文件。
   * 还有任务的工程拒绝移除并返回 false —— 否则下一轮轮询会把它按任务账写回来，
   * 调用方以为删掉了、界面却又出现，这种「静默无效」不能只靠视图不显示按钮来避免。
   */
  function forget(projectRoot: string): boolean {
    const root = String(projectRoot || "").trim()
    if (!root) return false
    if (projectHasTasks(areas, root)) return false
    setProjects(forgetProject(root))
    return true
  }

  return { areas: areas, tasks: tasks, projects: projects, loaded: loaded, reload: loadBoard, forget: forget }
}
