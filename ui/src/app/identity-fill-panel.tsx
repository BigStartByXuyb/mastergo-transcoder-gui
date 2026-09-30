import { Loader2, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ProjectPagesPicker, type TargetPick } from "@/app/project-pages-picker"
import type { IdentityInputs } from "@/app/use-identity"
import type { IdentityCandidate, ProjectPages } from "@/lib/api"
import { AUTOMATION_LABEL, adoptsIdentityWithoutConfirm } from "@/lib/task-form"

/*
 * 「可自动补齐」这一组里的交互：两个补全按钮、候选、提示，以及登记表里已登记的页面。
 * 取值链与写登记表都在 useIdentity：这里收的是它当前认的输入、要画的状态，以及几个回调。
 */

export function IdentityFillPanel(props: {
  /** 当前输入：来源与 hook 内部那一份是同一处（use-identity 返回的 inputs）。 */
  inputs: IdentityInputs
  state: {
    candidates: IdentityCandidate[]
    busy: string
    derivedUi: string
    pages: ProjectPages | null
  }
  actions: {
    onFill: () => void
    onApply: (item: IdentityCandidate) => void
    onTakePageName: () => void
    onPick: (patch: TargetPick) => void
  }
}) {
  const { inputs, state, actions } = props
  const bothEmpty = !inputs.ui.trim() && !inputs.target.trim()
  // 填了 Target 但仍推不出区域：这是最容易被误判成「插件坏了」的情况，必须提前说清原因。
  const targetWithoutPrefix = !inputs.ui.trim() && Boolean(inputs.target.trim()) && !state.derivedUi

  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={state.busy !== ""} onClick={actions.onFill}>
          {state.busy === "candidates" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          自动补 Target / 区域
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={state.busy !== "" || !inputs.link.trim()}
          onClick={actions.onTakePageName}
        >
          {state.busy === "name" ? <Loader2 className="size-4 animate-spin" /> : null}
          从链接取设计页名
        </Button>
        <span>
          按项目既有区域约定 + 设计页名给出候选并写进工程登记表；当前自动化层级：
          {AUTOMATION_LABEL[inputs.automation] ?? inputs.automation}
          {adoptsIdentityWithoutConfirm(inputs.automation)
            ? "（这一页登记过就自动沿用；没登记过由模型按设计页名给名直接采用，给不出才停下来要你点一次）"
            : "（列出来，你点一下再写）"}
        </span>
      </div>

      {state.candidates.length > 0 && (
        <div className="flex flex-col gap-1">
          {state.candidates.map((item, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={item.needsSemanticName ? "outline" : "default"}
                disabled={!item.target || item.needsSemanticName || state.busy !== ""}
                onClick={() => actions.onApply(item)}
              >
                {item.needsSemanticName ? "还缺语义名" : item.target}
              </Button>
              <span>
                {item.ui ? "UI " + item.ui + " · " : ""}
                {item.basis}
                {typeof item.confidence === "number" ? " · 置信度 " + item.confidence : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {state.derivedUi && (
        <span>将使用 UI={state.derivedUi}（按 Target 前缀推导；插件自己也会这么算）</span>
      )}
      {bothEmpty && (
        <span className="text-amber-600">
          UI 与 Target 都空：插件会按取值链解析（登记表 → Target 前缀/首词）；都取不到就会在入口停下。
          最省事的做法是把 Target 写成带区域前缀的形式，例如 F3Align。
        </span>
      )}
      {targetWithoutPrefix && (
        <span className="text-amber-600">
          Target「{inputs.target.trim()}」推不出区域前缀：插件只认两种形状——带编号前缀（F3Align → F3）或
          大写开头的首词（HomeContent → Home）。当前这个写成小写/下划线，两条都不命中。
          要么把 UI 区域显式填上，要么把 Target 改成 F3{inputs.target.trim()}（或用 PascalCase 如 TestMastergp）。
        </span>
      )}

      <ProjectPagesPicker pages={state.pages} target={inputs.target} ui={inputs.ui} onPick={actions.onPick} />
    </div>
  )
}
