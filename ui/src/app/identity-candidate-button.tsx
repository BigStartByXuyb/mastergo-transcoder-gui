import { Button } from "@/components/ui/button"
import type { IdentityCandidate } from "@/lib/api"

/*
 * 一个身份候选的按钮：怎么标、怎么禁、还缺语义名时说什么，只有这一处（按钮上的字由调用方给：
 * 两处的语境不同 —— 看板那一行把 UI 一起显示，新建任务卡片在旁边的说明里显示它）。
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
  return (
    <Button
      size="sm"
      variant={item.needsSemanticName ? "outline" : "default"}
      // 没目标的候选点了没意义；还缺语义名的那种要人先补名字；忙着的时候一律禁。
      disabled={!item.target || Boolean(item.needsSemanticName) || props.busy}
      onClick={props.onTake}
    >
      {item.needsSemanticName ? "还缺语义名" : props.label}
    </Button>
  )
}
