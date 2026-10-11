import type { ReactNode } from "react"

/*
 * 表单里的一组：标题 + 一句话说清「这组留空会怎样」。
 * 新建任务那张表单（ui/src/app/new-task-card.tsx）与看板的创建任务弹窗共用这一份 ——
 * 「必填 / 可自动补齐 / 可选」这三组在两张表单上说的是同一件事，措辞与排法不各写一套。
 */
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
