import type { ReactNode } from "react"

/*
 * 表单里的一组：标题 + 一句话说清「这组留空会怎样」。三组的标题与提示语只有下面这一处 ——
 * 新建任务那张表单（ui/src/app/new-task-card.tsx）与看板的创建任务弹窗都从这里取，
 * 两张表单对「必填 / 可自动补齐 / 可选」说的是同一句话。
 */

export const FIELD_GROUPS = {
  required: { title: "必填", hint: "不填跑不了" },
  autofill: { title: "可自动补齐", hint: "留空就按工程登记表解析；也可以让它按设计页名补" },
  optional: { title: "可选", hint: "不填就走默认" }
} as const

export function FieldGroup(props: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border px-3 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">{props.title}</span>
        <span className="text-muted-foreground text-xs">{props.hint}</span>
      </div>
      {props.children}
    </section>
  )
}
