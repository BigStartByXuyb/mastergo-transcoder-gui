import { readStored, writeStored } from "@/lib/storage"

/*
 * 用过的工程目录：侧边栏要能列出「工程 → 区域」，但区域只存在于具体工程里，
 * 所以得先记住用户碰过哪些工程（任务的工程 + 表单里填过的）。上限 8 条，最近用的排前面。
 */

const STORAGE_KEY = "mastergo-transcoder-gui.projects"
const MAX_PROJECTS = 8

export function readRecentProjects(): string[] {
  return readStored<string[]>(STORAGE_KEY, [], (raw) => {
    const list = Array.isArray(raw.projects) ? raw.projects : []
    return list.map((item) => String(item || "").trim()).filter(Boolean).slice(0, MAX_PROJECTS)
  })
}

export function rememberProject(projectRoot: string): string[] {
  const root = String(projectRoot || "").trim()
  if (!root) return readRecentProjects()
  const next = [root, ...readRecentProjects().filter((item) => item !== root)].slice(0, MAX_PROJECTS)
  writeStored(STORAGE_KEY, { projects: next })
  return next
}

export function forgetProject(projectRoot: string): string[] {
  const root = String(projectRoot || "").trim()
  const next = readRecentProjects().filter((item) => item !== root)
  writeStored(STORAGE_KEY, { projects: next })
  return next
}
