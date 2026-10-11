import { Button } from "@/components/ui/button"
import type { IdentityCandidate } from "@/lib/api"

/*
 * 一个身份候选的按钮：怎么标、怎么禁、没有名字 / 还缺语义名时说什么，只有这一处。
 * 能用的候选用调用方给的 label 当按钮字（两处语境不同：看板那一行把 UI 一起显示，
 * 新建任务卡片在旁边的说明里显示它），调用方不用自己过滤「没名字的」那种。
 * 新建任务那张表单的补全面板（identity-fill-panel.tsx）与看板创建任务弹窗（board-identity-fill.tsx）共用。
 */
export function IdentityCandidateButton(props: {
  item: IdentityCandidate
  /** 这一条线上的动作在忙时一律禁（忙位由各自的 hook 给）。 */
  busy: boolean
  label: string
  onTake: () => void
}) {
  const item = props.item
  // 没有 target 的候选点了没意义：如实说一句并禁掉（这个判据只有这一处，调用方不再各过滤一遍）。
  const nameless = !item.target
  return (
    <Button
      size="sm"
      variant={nameless || item.needsSemanticName ? "outline" : "default"}
      // 还缺语义名的那种要人先补名字；忙着的时候一律禁。
      disabled={nameless || Boolean(item.needsSemanticName) || props.busy}
      onClick={props.onTake}
    >
      {nameless ? "没有可选的名字" : item.needsSemanticName ? "还缺语义名" : props.label}
    </Button>
  )
}
