import type { BoardTask } from "@/lib/api"
import { isBusyState } from "@/lib/task-state"

/*
 * 侧边栏的导航模型：工程 → 区域（UI）。
 *
 * 主键是「工程目录 + 区域」，不是单独的 ui —— 两个项目都有 F1 时必须分成两条，
 * 而且「复制区域模板」要回填的是这两个字段（插件第一步就要 -ProjectRoot）。
 * 区域里的两部分：登记表里的页面（这一页属于哪个区域，插件自己的口径）与该区域的任务。
 */

/** 登记表里的一页：区域归属来自插件自己的口径（pages[].ui，缺省则由 derivation 里的 F<n> 兜）。 */
export type AreaPage = { target: string; layerId: string; designPageName: string; ui: string }

export type AreaEntry = {
  /** 工程 + 区域的稳定 key，路由与选中态都用它。 */
  key: string
  projectRoot: string
  ui: string
  pages: AreaPage[]
  tasks: BoardTask[]
  running: number
}

export function areaKey(projectRoot: string, ui: string): string {
  return projectRoot + "|" + ui
}

/** 没写区域的条目挂在同一个空 ui 下：界面显示成「未定区域」，不允许出现两条空区域。 */
export function buildAreas(input: {
  projects: string[]
  pagesByProject: Record<string, AreaPage[]>
  tasks: BoardTask[]
}): AreaEntry[] {
  const projects = new Set<string>()
  for (const item of input.projects) {
    const root = String(item || "").trim()
    if (root) projects.add(root)
  }
  for (const task of input.tasks) {
    const root = String(task.request?.projectRoot || "").trim()
    if (root) projects.add(root)
  }

  const areas: AreaEntry[] = []
  for (const projectRoot of [...projects].sort()) {
    const pages = input.pagesByProject[projectRoot] ?? []
    const uis = new Set<string>()
    for (const page of pages) uis.add(String(page.ui ?? ""))
    for (const task of input.tasks) {
      if (String(task.request?.projectRoot || "").trim() !== projectRoot) continue
      uis.add(String(task.request?.ui || ""))
    }
    for (const ui of [...uis].sort()) {
      const areaTasks = input.tasks.filter(
        (task) => String(task.request?.projectRoot || "").trim() === projectRoot && String(task.request?.ui || "") === ui
      )
      areas.push({
        key: areaKey(projectRoot, ui),
        projectRoot: projectRoot,
        ui: ui,
        pages: pages.filter((page) => String(page.ui ?? "") === ui),
        tasks: areaTasks,
        running: areaTasks.filter((task) => isBusyState(task.state)).length
      })
    }
  }
  return areas
}

/** 区域在侧边栏里的显示名：没登记区域的条目也得能看、能点。 */
export function areaLabel(ui: string): string {
  return ui || "未定区域"
}
