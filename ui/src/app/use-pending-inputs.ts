import { useCallback, useEffect, useState } from "react"

import { useAlive } from "@/app/use-alive"
import { api, type Pending } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 待确认清单的取数、三张草稿（命名表 / 译文 / 术语）与叫 AI 出候选。
 * 面板（app/pending-panel.tsx）只管渲染与提交编排；「提交」那条动作仍在面板里（它要 toast 与 onResumed）。
 *
 *   取数：/api/pending 只在这里取一次（docs/facts.md 登记的那一处）。什么时候重读：
 *     「去哪一页取」变了、来源换了（换了任务 / 换了一次运行），或者同一次运行从「跑着」变成「停下」
 *     —— 那之后会新出现待办，不重读就看不见。
 *   草稿：三张表的初值在同一次读数里铺开（不覆盖人已经改过的格子）。
 *   叫 AI：候选落进草稿的口径只有这一处（例如命名表里 fromDsl 的处理），失败回 null 并把原话写进 failure。
 */

/** 命名表草稿的一项（提交要的形状）。 */
export type NamingItem = { index: number; name: string; comment: string; fromDsl?: boolean }
/** 叫 AI 的一次结果：要提交的那份输入 + 模型给了几条。 */
export type Filled<T> = { value: T; count: number }

export function usePendingInputs(input: {
  projectRoot: string
  target: string
  /** 看板任务 id：续跑按它落回那一行（面板提交时用），这里只用它判断来源有没有换。 */
  taskId: string
  runId: string
  /** 来源运行/任务的状态：它一变就重读（「跑着 → 停下」后会新出现待办）。 */
  state: string
}) {
  const { projectRoot, target, taskId, runId, state } = input
  const [pending, setPending] = useState<Pending | null>(null)
  const [names, setNames] = useState<Record<number, { name: string; comment: string }>>({})
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [glossary, setGlossary] = useState<Record<string, string>>({})
  /** 取数 / 叫模型这两件事的忙位（提交那条由面板自己管）。 */
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const [aiReady, setAiReady] = useState<boolean | null>(null)
  const alive = useAlive()

  // 没配模型就别去撞错误：直接说明白，让人工填这条路照常可用。
  useEffect(() => {
    api
      .settingsGet()
      .then((payload) =>
        setAiReady(payload.settings.ai.hasKey && Boolean(payload.settings.ai.baseUrl) && Boolean(payload.settings.ai.model))
      )
      .catch(() => setAiReady(false))
  }, [])

  const reload = useCallback(async () => {
    if (!projectRoot.trim() || !target.trim()) return
    setBusy("load")
    setFailure("")
    try {
      const payload = await api.pending(projectRoot, target)
      if (!alive.current) return
      setPending(payload.pending)
      setNames((current) => {
        const next = { ...current }
        for (const item of payload.pending.icons.mustName) {
          if (!next[item.index]) next[item.index] = { name: "", comment: "" }
        }
        for (const row of payload.pending.icons.naming) next[row.index] = { name: row.name ?? "", comment: row.comment ?? "" }
        return next
      })
      setTexts((current) => {
        const next = { ...current }
        for (const item of payload.pending.translations.pendingTranslations) {
          if (next[item.text] === undefined) next[item.text] = payload.pending.translations.translations[item.text] ?? ""
        }
        return next
      })
      setGlossary((current) => {
        const next = { ...current }
        for (const item of payload.pending.translations.glossaryRequired) {
          if (next[item.text] === undefined) next[item.text] = payload.pending.translations.glossary[item.text] ?? ""
        }
        return next
      })
    } catch (error) {
      if (alive.current) setFailure(describeFailure(error))
    } finally {
      if (alive.current) setBusy("")
    }
  }, [alive, projectRoot, target])

  useEffect(() => {
    void reload()
  }, [reload, state, taskId, runId])

  /* 三张表的载荷：只有填了的格子进提交（空名字、空译文不算人填过）。 */
  const namingPayload = useCallback(
    (): NamingItem[] =>
      (pending?.icons.mustName ?? []).map((item) => ({
        index: item.index,
        name: names[item.index]?.name ?? "",
        comment: names[item.index]?.comment ?? "",
        // 整页几何的条目由后端的机械判定决定（sourceId 指向页面根），不由模型猜。
        ...(item.sourceIsPageRoot ? { fromDsl: true } : {})
      })),
    [pending, names]
  )

  const translationsPayload = useCallback(() => {
    const out: Record<string, string> = {}
    for (const item of pending?.translations.pendingTranslations ?? []) {
      const value = texts[item.text]
      if (value && value.trim()) out[item.text] = value.trim()
    }
    return out
  }, [pending, texts])

  const glossaryPayload = useCallback(() => {
    const out: Record<string, string> = {}
    for (const item of pending?.translations.glossaryRequired ?? []) {
      const value = glossary[item.text]
      if (value && value.trim()) out[item.text] = value.trim()
    }
    return out
  }, [pending, glossary])

  /*
   * 叫 AI 出候选 → 预填草稿 → 交回 {这次要提交的那份, 模型给了几条}。
   * 自动那条路与三个手动按钮都走这三个函数：候选落进 state 的口径只有这一处。失败回 null（原话已写进 failure）。
   */
  const aiFill = useCallback(
    async function <T>(key: string, work: () => Promise<{ value: T; count: number }>): Promise<Filled<T> | null> {
      setBusy(key)
      setFailure("")
      try {
        return await work()
      } catch (error) {
        if (alive.current) setFailure("AI 出候选失败（可以人工填）：" + describeFailure(error))
        return null
      } finally {
        if (alive.current) setBusy("")
      }
    },
    [alive]
  )

  const fillIconNames = useCallback(async (): Promise<Filled<NamingItem[]> | null> => {
    const list = pending?.icons.mustName ?? []
    return await aiFill("ai-icons", async () => {
      const payload = await api.aiIconNames(list)
      const patch: Record<number, { name: string; comment: string }> = {}
      for (const item of payload.items) patch[item.index] = { name: item.name, comment: item.comment }
      setNames((current) => ({ ...current, ...patch }))
      return {
        value: list.map((item) => ({
          index: item.index,
          name: patch[item.index]?.name ?? "",
          comment: patch[item.index]?.comment ?? "",
          ...(item.sourceIsPageRoot ? { fromDsl: true } : {})
        })),
        count: payload.items.length
      }
    })
  }, [aiFill, pending])

  const fillTranslations = useCallback(async (): Promise<Filled<Record<string, string>> | null> => {
    const list = pending?.translations.pendingTranslations ?? []
    return await aiFill("ai-lang", async () => {
      const payload = await api.aiTranslations(list.map((item) => item.text))
      const patch: Record<string, string> = {}
      for (const item of payload.items) patch[item.text] = item.translation
      setTexts((current) => ({ ...current, ...patch }))
      const out: Record<string, string> = {}
      for (const item of list) {
        const value = patch[item.text]
        if (value && value.trim()) out[item.text] = value.trim()
      }
      return { value: out, count: payload.items.length }
    })
  }, [aiFill, pending])

  const fillGlossary = useCallback(async (): Promise<Filled<Record<string, string>> | null> => {
    const list = pending?.translations.glossaryRequired ?? []
    return await aiFill("ai", async () => {
      const payload = await api.aiGlossary(list.map((item) => item.text))
      const patch: Record<string, string> = {}
      for (const item of payload.items) patch[item.text] = item.identifier
      setGlossary((current) => ({ ...current, ...patch }))
      const out: Record<string, string> = {}
      for (const item of list) {
        const value = patch[item.text]
        if (value && value.trim()) out[item.text] = value.trim()
      }
      return { value: out, count: payload.items.length }
    })
  }, [aiFill, pending])

  return {
    pending,
    names,
    setNames,
    texts,
    setTexts,
    glossary,
    setGlossary,
    aiReady,
    busy,
    failure,
    reload,
    namingPayload,
    translationsPayload,
    glossaryPayload,
    fillIconNames,
    fillTranslations,
    fillGlossary
  }
}
