import { api, type IdentityCandidate } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import type { BoardItem } from "@/lib/board-items"
import { candidatesForLink, resolveExplicitTarget } from "@/lib/identity-flow"
import { pickIdentityCandidate } from "@/lib/identity-pick"
import {
  adoptsIdentityWithoutConfirm,
  requestDefaultsOf,
  type BoardRequestDefaults
} from "@/lib/task-form"

/*
 * 流水线 A 启动前把页面身份自动落实：取数与写回走 identity-flow，采用判定走 identity-pick。
 * 人写下的 Target 优先；否则先走机械候选，只有「自动」层级才让模型补语义名。
 * 后端 blocked 时停回调用方。B/AB 继续走原有身份流程。
 */

export type PreparedPipelineItem = BoardItem & { ui: string }
export type PreparedPipelineIdentity = {
  link: string
  projectRoot: string
  pageName: string
  item: IdentityCandidate
}

export type PreparedPipelineItems =
  | {
      ok: true
      items: PreparedPipelineItem[]
      defaults: BoardRequestDefaults
      identities: PreparedPipelineIdentity[]
    }
  | { ok: false; reason: string }

type IdentitySelection =
  | { kind: "picked"; candidate: IdentityCandidate }
  | { kind: "none" }
  | { kind: "rejected"; reason: string }

type ConcreteIdentitySelection = Exclude<IdentitySelection, { kind: "none" }>

type PreparedOne =
  | { kind: "prepared"; item: PreparedPipelineItem; identity: PreparedPipelineIdentity }
  | { kind: "rejected"; reason: string }

const PIPELINE_A_REQUEST_DEFAULTS = requestDefaultsOf({
  ui: "",
  autoMerge: true,
  overwrite: true,
  stopAfter: ""
})

async function explicitTargetSelection(
  target: string,
  candidates: IdentityCandidate[]
): Promise<IdentitySelection> {
  const resolved = await resolveExplicitTarget({
    target: target,
    candidates: candidates,
    loadTargetParts: api.identityPrefix,
    basis: "看板行手写的 Target"
  })
  if (resolved.kind === "none") return { kind: "none" }
  return resolved.kind === "picked"
    ? resolved
    : { kind: "rejected", reason: resolved.reason }
}

async function automaticSelection(
  base: { link: string; projectRoot: string; pageName: string; ui: string },
  initial: { items: IdentityCandidate[]; blocked: string },
  automation: string
): Promise<ConcreteIdentitySelection> {
  let got = initial
  let decision = pickIdentityCandidate(got.items, got.blocked, { autoOnly: true })
  const allowAi = adoptsIdentityWithoutConfirm(automation)
  if (!decision.pick && !got.blocked && allowAi) {
    got = await candidatesForLink({ ...base, useAi: true, autoAdopt: true })
    decision = pickIdentityCandidate(got.items, got.blocked, { autoOnly: true })
  }
  if (decision.pick) return { kind: "picked", candidate: decision.pick }
  return {
    kind: "rejected",
    reason: !got.blocked && !allowAi
      ? decision.reason + " 当前自动化层级不会把模型候选直接写回；切到「自动」后重试。"
      : decision.reason
  }
}

async function prepareOne(
  item: BoardItem,
  projectRoot: string,
  automation: string
): Promise<PreparedOne> {
  try {
    const named = await api.designPageName(item.link)
    const base = { link: item.link, projectRoot, pageName: named.pageName, ui: "" }
    const got = await candidatesForLink({ ...base, useAi: false, autoAdopt: true })
    const manual = await explicitTargetSelection(item.target.trim(), got.items)
    const selection = manual.kind === "none" ? await automaticSelection(base, got, automation) : manual
    if (selection.kind === "rejected") return selection
    const candidate = selection.candidate
    return {
      kind: "prepared",
      item: { ...item, target: candidate.target, ui: candidate.ui },
      identity: { link: item.link, projectRoot, pageName: named.pageName, item: candidate }
    }
  } catch (error) {
    return { kind: "rejected", reason: describeFailure(error) }
  }
}

/** 逐项只读准备；身份写回在任务创建事务内由 applyIdentities 一次完成。 */
export async function preparePipelineAItems(
  items: BoardItem[],
  projectRoot: string,
  options: { automation: string }
): Promise<PreparedPipelineItems> {
  const prepared: PreparedPipelineItem[] = []
  const identities: PreparedPipelineIdentity[] = []
  for (const item of items) {
    const result = await prepareOne(item, projectRoot, options.automation)
    if (result.kind === "rejected") return { ok: false, reason: result.reason }
    prepared.push(result.item)
    identities.push(result.identity)
  }
  return {
    ok: true,
    items: prepared,
    defaults: PIPELINE_A_REQUEST_DEFAULTS,
    identities
  }
}
