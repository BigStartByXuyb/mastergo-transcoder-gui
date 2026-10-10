import { useCallback, useEffect, useState } from "react"

import { useValueRunner } from "@/app/use-action-runner"
import { useAlive } from "@/app/use-alive"
import { api, type Pending } from "@/lib/api"

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

/*
 * 忙位键名：面板按它决定哪个按钮转圈 / 显示「正在读清单」。
 * 名字就是这几件事自己的名字 —— 面板从这里取（`PENDING_BUSY.*`），不在两边各写一份字符串。
 */
export const PENDING_BUSY = {
  load: "load",
  icons: "ai-icons",
  translations: "ai-lang",
  glossary: "ai"
} as const

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
  /*
   * 两个配置，同一份骨架（ui/src/app/use-action-runner.ts）：
   *   run   —— 取数：失败就照原话写进 failure；
   *   runAi —— 叫模型：同一份骨架，只是失败那句话前面补一句「可以人工填」，让人知道还有别的路。
   */
  const run = useValueRunner({ setWorking: setBusy, setFailure: setFailure })
  const runAi = useValueRunner({
    setWorking: setBusy,
    setFailure: (message) => setFailure(message ? "AI 出候选失败（可以人工填）：" + message : "")
  })

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
    await run(PENDING_BUSY.load, () => api.pending(projectRoot, target), (payload) => {
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
    })
  }, [alive, projectRoot, target, run])

  useEffect(() => {
    void reload()
  }, [reload, state, taskId, runId])

  /*
   * 命名表草稿 → 提交形状：只有这一处（人填的那份与模型出的那份共用它）。
   * fromDsl 由后端的机械判定决定（sourceId 指向页面根的条目，几何改由它自己的 PATH 节点合成），不由模型猜。
   */
  const namingItemsOf = useCallback(
    (pick: (index: number) => { name: string; comment: string } | undefined): NamingItem[] =>
      (pending?.icons.mustName ?? []).map((item) => ({
        index: item.index,
        name: pick(item.index)?.name ?? "",
        comment: pick(item.index)?.comment ?? "",
        ...(item.sourceIsPageRoot ? { fromDsl: true } : {})
      })),
    [pending]
  )

  /*
   * 改一张草稿只有这几个落点（面板不直接改内部记录的形状）：
   *   setName        命名表某一条的名字 / 备注；
   *   setText        译文某一条；
   *   setGlossaryOf  术语表某一条。
   */
  const setName = useCallback((index: number, patch: { name?: string; comment?: string }) => {
    setNames((current) => ({
      ...current,
      [index]: {
        name: patch.name ?? current[index]?.name ?? "",
        comment: patch.comment ?? current[index]?.comment ?? ""
      }
    }))
  }, [])

  const setText = useCallback((text: string, value: string) => {
    setTexts((current) => ({ ...current, [text]: value }))
  }, [])

  const setGlossaryOf = useCallback((text: string, value: string) => {
    setGlossary((current) => ({ ...current, [text]: value }))
  }, [])

  /** 面板那条提交动作开始时调它：把这条数据线的旧失败清掉，别让它盖住刚发生的提交失败。 */
  const clearFailure = useCallback(() => setFailure(""), [])
  /*
   * 失败这句话面板也要写（提交那条动作）：只留一个槽、谁开始干活谁先清 ——
   * 两个槽再合成一句，就会出现「旧的盖住新的」与它的反面（成功之后旧的还挂着）两种毛病。
   */
  const writeFailure = useCallback((message: string) => setFailure(message), [])

  /*
   * 三张表的载荷：只有填了的格子进提交（空名字、空译文不算人填过）。
   * 「按这份清单取、只收非空的」两处共用同一个拼法（稿子不同、清单不同）。
   */
  const textMapPayload = useCallback(
    (list: { text: string }[], draft: Record<string, string>) => {
      const out: Record<string, string> = {}
      for (const item of list) {
        const value = draft[item.text]
        if (value && value.trim()) out[item.text] = value.trim()
      }
      return out
    },
    []
  )

  const namingPayload = useCallback((): NamingItem[] => namingItemsOf((index) => names[index]), [names, namingItemsOf])
  const translationsPayload = useCallback(
    () => textMapPayload(pending?.translations.pendingTranslations ?? [], texts),
    [pending, texts, textMapPayload]
  )
  const glossaryPayload = useCallback(
    () => textMapPayload(pending?.translations.glossaryRequired ?? [], glossary),
    [pending, glossary, textMapPayload]
  )

  /*
   * 叫 AI 出候选 → 预填草稿 → 交回 {这次要提交的那份, 模型给了几条}。
   * 自动那条路与三个手动按钮都走这三个函数：候选落进 state 的口径只有这一处。失败回 null（原话已写进 failure）。
   */
  const fillIconNames = useCallback(async (): Promise<Filled<NamingItem[]> | null> => {
    const list = pending?.icons.mustName ?? []
    return await runAi(PENDING_BUSY.icons, async () => {
      const payload = await api.aiIconNames(list)
      const patch: Record<number, { name: string; comment: string }> = {}
      for (const item of payload.items) patch[item.index] = { name: item.name, comment: item.comment }
      setNames((current) => ({ ...current, ...patch }))
      return {
        value: namingItemsOf((index) => patch[index]),
        count: payload.items.length
      }
    })
  }, [runAi, pending, namingItemsOf])

  /*
   * 译文与术语同形：问模型「每条文本 → 一个值」，落进对应的那张草稿，再交回填了的那些（空的不算人填过）。
   * 两类共用这一个实现，只是取哪个字段、写哪张草稿不同。
   */
  const fillTextMap = useCallback(
    async (
      key: string,
      list: { text: string }[],
      ask: (texts: string[]) => Promise<{ text: string; value: string }[]>,
      apply: (patch: Record<string, string>) => void
    ): Promise<Filled<Record<string, string>> | null> =>
      await runAi(key, async () => {
        const items = await ask(list.map((item) => item.text))
        const patch: Record<string, string> = {}
        for (const item of items) patch[item.text] = item.value
        apply(patch)
        // 「只收非空的」那一半与载荷拼装同一处（textMapPayload）：两边都是「按这份清单取、丢掉空的」。
        return { value: textMapPayload(list, patch), count: items.length }
      }),
    [runAi, textMapPayload]
  )

  const fillTranslations = useCallback(async (): Promise<Filled<Record<string, string>> | null> => {
    const list = pending?.translations.pendingTranslations ?? []
    return await fillTextMap(
      PENDING_BUSY.translations,
      list,
      async (texts) => (await api.aiTranslations(texts)).items.map((item) => ({ text: item.text, value: item.translation })),
      (patch) => setTexts((current) => ({ ...current, ...patch }))
    )
  }, [fillTextMap, pending])

  const fillGlossary = useCallback(async (): Promise<Filled<Record<string, string>> | null> => {
    const list = pending?.translations.glossaryRequired ?? []
    return await fillTextMap(
      PENDING_BUSY.glossary,
      list,
      async (texts) => (await api.aiGlossary(texts)).items.map((item) => ({ text: item.text, value: item.identifier })),
      (patch) => setGlossary((current) => ({ ...current, ...patch }))
    )
  }, [fillTextMap, pending])

  return {
    pending,
    names,
    texts,
    glossary,
    setName,
    setText,
    setGlossaryOf,
    aiReady,
    busy,
    failure,
    clearFailure,
    writeFailure,
    reload,
    namingPayload,
    translationsPayload,
    glossaryPayload,
    fillIconNames,
    fillTranslations,
    fillGlossary
  }
}
