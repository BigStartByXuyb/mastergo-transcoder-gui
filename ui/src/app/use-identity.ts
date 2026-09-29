import { useEffect, useState } from "react"
import { toast } from "sonner"

import { api, type IdentityCandidate, type ProjectPages } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { pickIdentityCandidate } from "@/lib/identity-pick"

/*
 * 页面身份：Target 与 UI 区域。
 *
 * 「选候选 → 写工程登记表 → 回填表单」只有这一处实现，按钮与自动层级启动前都调它；
 * 分叉会让两条入口对同一页给出不同结论。候选列表只跟工程目录有关，区域预览只跟 Target 有关
 * （规则在后端，前端不算），两者各自取数，互不牵连。
 */

export type IdentityOptions = {
  link: string
  projectRoot: string
  target: string
  ui: string
  automation: string
  onFailure: (message: string) => void
  onPicked: (target: string, ui: string) => void
}

export function useIdentity(options: IdentityOptions) {
  const { link, projectRoot, target, ui, automation, onFailure, onPicked } = options
  const [pages, setPages] = useState<ProjectPages | null>(null)
  const [previewUi, setPreviewUi] = useState("")
  const [name, setName] = useState("")
  const [candidates, setCandidates] = useState<IdentityCandidate[]>([])
  const [busy, setBusy] = useState("")

  function loadPages(root: string) {
    if (!root) {
      setPages(null)
      return
    }
    api
      .projectPages(root)
      .then((payload) => setPages(payload.pages))
      .catch(() => setPages(null))
  }

  useEffect(() => {
    const root = projectRoot.trim()
    const timer = window.setTimeout(() => loadPages(root), 600)
    return () => window.clearTimeout(timer)
  }, [projectRoot])

  useEffect(() => {
    const next = target.trim()
    if (!next) {
      setPreviewUi("")
      return
    }
    const timer = window.setTimeout(() => {
      api
        .identityPrefix(next)
        .then((payload) => setPreviewUi(payload.previewUi))
        .catch(() => setPreviewUi(""))
    }, 600)
    return () => window.clearTimeout(timer)
  }, [target])

  /* 取候选并判定能不能自动采用；要人决策时把原因写进 failure，返回 null。 */
  async function pick(): Promise<IdentityCandidate | null> {
    const payload = await api.identityCandidates({
      projectRoot: projectRoot.trim(),
      pageName: name.trim() || target.trim(),
      useAi: automation !== "off",
      // 已经在 UI 区域框里写了区域（例如 F1）时，就按你给的那个算候选。
      ui: ui.trim(),
      link: link.trim()
    })
    const list: IdentityCandidate[] = [...(payload.ai.items ?? []), ...(payload.candidates ?? [])]
    setCandidates(list)
    const decision = pickIdentityCandidate(list, payload.ambiguous)
    if (decision.pick) return decision.pick
    onFailure(decision.reason)
    return null
  }

  async function apply(item: IdentityCandidate) {
    if (!item.target || !item.ui) return
    setBusy("apply")
    try {
      const written = await api.identityApply({
        projectRoot: projectRoot.trim(),
        target: item.target,
        ui: item.ui,
        // 把链接一起交给后端解析设计来源：链接解析只有插件那份实现，前端不自己拆 URL。
        link: link.trim(),
        designPageName: name.trim() || target.trim()
      })
      onPicked(item.target, item.ui)
      toast.success("已写入登记表（" + (written.replaced ? "替换" : "新增") + "）：" + item.target + " · UI " + item.ui)
      setCandidates([])
      loadPages(projectRoot.trim())
      // 预览不用在这里再取一次：回填会让上面那条 effect 跑（同一件事只有一个入口）。
    } catch (error) {
      onFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  // 手动入口：列候选；自动化层级是「自动」时直接采用第一条。
  async function fill() {
    setBusy("candidates")
    onFailure("")
    try {
      const picked = await pick()
      if (picked && automation === "auto") await apply(picked)
    } catch (error) {
      onFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  function takeDesignPageName() {
    setBusy("name")
    onFailure("")
    api
      .designPageName(link.trim())
      .then((payload) => {
        setName(payload.pageName)
        toast.success("设计页名：" + (payload.pageName || "（设计稿里没有名字）"))
      })
      .catch((error) => onFailure(describeFailure(error)))
      .finally(() => setBusy(""))
  }

  /* 手填了区域就以手填的为准；预览只在没手填时用于提示。 */
  const derivedUi = ui.trim() ? "" : previewUi

  return { pages, derivedUi, name, setName, candidates, busy, pick, apply, fill, takeDesignPageName }
}
