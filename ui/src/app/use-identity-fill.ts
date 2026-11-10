import { useState } from "react"
import { toast } from "sonner"

import { api, type IdentityCandidate } from "@/lib/api"
import type { BoardItem } from "@/lib/board-items"
import { describeFailure } from "@/lib/describe-failure"
import {
  applyIdentities,
  applyIdentity,
  candidatesForLink,
  type ApplyIdentityInput
} from "@/lib/identity-flow"
import { pickIdentityCandidate } from "@/lib/identity-pick"
import { adoptsIdentityWithoutConfirm } from "@/lib/task-form"

/*
 * 看板弹窗里的「按链接补 Target / 区域」：一行一个链接，逐个取设计页名 → 取候选，
 * 自动化层级是「自动」时直接采用能定的那条并写进工程登记表，其余按行给出候选让人点一条。
 *
 * 取候选与写登记表走的是新建任务卡片那一套实现（lib/identity-flow.ts），
 * 所以两条入口对同一页给出的是同一个结论。回填文本由调用方在 onFilled 里做，本 hook 不碰表单。
 */

export type FillRow =
  | { kind: "filled"; link: string; target: string; ui: string; basis: string }
  | { kind: "pick"; link: string; pageName: string; items: IdentityCandidate[]; reason: string }
  | { kind: "none"; link: string; reason: string }

export function useIdentityFill(options: {
  automation: string
  onFilled: (targets: Map<string, string>) => void
  onFailure: (message: string) => void
}) {
  const [rows, setRows] = useState<FillRow[]>([])
  const [busy, setBusy] = useState("")
  const [root, setRoot] = useState("")

  async function run(items: BoardItem[], projectRoot: string, ui: string) {
    setBusy("fill")
    setRoot(projectRoot.trim())
    options.onFailure("")
    const next: FillRow[] = []
    const autoWrite: { row: number; input: ApplyIdentityInput; basis: string }[] = []
    const filled = new Map<string, string>()
    try {
      for (const item of items) {
        // 这一行自己写了 Target 就以人写的为准，不去覆盖它。
        if (item.target) {
          next.push({ kind: "filled", link: item.link, target: item.target, ui, basis: "这一行自己写了 Target，没动" })
          continue
        }
        const named = await api.designPageName(item.link)
        const got = await candidatesForLink({
          link: item.link,
          projectRoot,
          pageName: named.pageName,
          ui,
          useAi: options.automation !== "off"
        })
        const decision = pickIdentityCandidate(got.items, got.blocked)
        if (!decision.pick || !adoptsIdentityWithoutConfirm(options.automation)) {
          const usable = got.items.some((candidate) => candidate.target && !candidate.needsSemanticName)
          next.push(
            usable
              ? { kind: "pick", link: item.link, pageName: named.pageName, items: got.items, reason: decision.reason }
              : { kind: "none", link: item.link, reason: decision.reason }
          )
          continue
        }
        const input = { link: item.link, projectRoot, pageName: named.pageName, item: decision.pick }
        autoWrite.push({ row: next.length, input, basis: decision.pick.basis })
        next.push({
          kind: "pick",
          link: item.link,
          pageName: named.pageName,
          items: got.items,
          reason: decision.reason
        })
      }
      setRows(next)
      if (autoWrite.length > 0) {
        await applyIdentities(autoWrite.map((entry) => entry.input))
        const committed = [...next]
        for (const entry of autoWrite) {
          const item = entry.input.item
          committed[entry.row] = {
            kind: "filled",
            link: entry.input.link,
            target: item.target,
            ui: item.ui,
            basis: entry.basis
          }
          filled.set(entry.input.link, item.target)
        }
        setRows(committed)
        options.onFilled(filled)
      }
    } catch (error) {
      // 候选行先上屏：批次写回失败时，人能看到哪些行还需要手动处理；登记表由后端整批回滚。
      setRows(next)
      options.onFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  /* 手动采纳一条候选：写登记表并把这一行的结果记成已定。 */
  async function take(row: FillRow, item: IdentityCandidate) {
    if (row.kind !== "pick" || !item.target || !item.ui) return
    setBusy("take:" + row.link)
    options.onFailure("")
    try {
      const written = await applyIdentity({ link: row.link, projectRoot: root, pageName: row.pageName, item })
      options.onFilled(new Map([[row.link, item.target]]))
      setRows((current) =>
        current.map((entry) =>
          entry === row
            ? { kind: "filled", link: row.link, target: item.target, ui: item.ui, basis: "已写入工程登记表" }
            : entry
        )
      )
      toast.success("已写入登记表（" + (written.replaced ? "替换" : "新增") + "）：" + item.target + " · UI " + item.ui)
    } catch (error) {
      options.onFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }

  /** 换了链接或工程就把上一次的结果清掉，免得旧结论看着像新的。 */
  function reset() {
    setRows([])
    setBusy("")
  }

  return { rows, busy, run, take, reset }
}
