import type { DerivedLayout, LayoutControl } from "@/lib/api"
import { treeLinesOf, type TreeLine } from "@/lib/layout-edit"
import { cn } from "@/lib/utils"

/*
 * 布局树：作业A **第 8 步推出来的布局**，摆成正常的树 —— 分区 → 组（装着子网格的格子，可以再套）→ 控件。
 *
 * 每一行算什么（key / 盖子哪些控件 / 行上写什么）在 ui/src/lib/layout-edit.ts 的 treeLinesOf 一处；
 * 这里只管怎么摆：缩进、字重、点一行把它交出去。树下面那两块读数（摆不进树的 / 插件报的单条目栏）
 * 也跟着 treeLinesOf 给的行摆，条目上挂的原因放在悬停提示里。
 */

/* 行的缩进：行首 4px，每套一层加 12px —— 树行与读数行共用这一处。 */
const BASE_PADDING = 4
const INDENT = 12

function indentOf(depth: number): number {
  return BASE_PADDING + depth * INDENT
}

/* 行的轻重：分区、组与读数行是结构（加深），控件按普通字重。 */
const KIND_CLASS: Record<TreeLine["kind"], string> = {
  region: "text-foreground font-semibold",
  group: "text-foreground font-medium",
  control: "text-foreground",
  extra: "text-foreground font-semibold"
}

/*
 * 一行（树行与读数行都走它）：选中态、点它交出去的 key、缩进、字重只有这一处 ——
 * 两处各写一遍的话，日后改选中样式或改交出去的 key，漏一处就会出现「一类行选不动」。
 */
function Line(props: {
  line: TreeLine
  selected: string
  onPick: (key: string) => void
}) {
  const on = props.selected === props.line.key
  return (
    <button
      type="button"
      data-selected={on}
      onClick={() => props.onPick(props.line.key)}
      className={cn(
        "rounded px-1 py-0.5 text-left text-xs hover:bg-accent",
        on && "bg-accent text-accent-foreground",
        KIND_CLASS[props.line.kind]
      )}
      style={{ paddingLeft: indentOf(props.line.depth) }}
    >
      {props.line.label}
    </button>
  )
}

export function LayoutTree(props: {
  /** 推导结果；还没读到这一页时是 null（这块不摆）。 */
  derived: DerivedLayout | null
  controls: LayoutControl[]
  /** 现在选中的是哪一行（调用方持有；空串＝没选）。 */
  selected: string
  /**
   * 点了一行：把这一行的 key 回给调用方。选中态与「要描哪些控件」都由调用方按当前读数算
   * （要描的 refs 在 treeLinesOf 给的那一行上，读数刷新后跟着变，不留上一次那一份）。
   */
  onPick: (key: string) => void
}) {
  if (!props.derived) return null

  /*
   * 不可用时只说后端给的那句（措辞只有 lib/derived-layout.js 一处，界面不另拟一份）；
   * 到这一支就是后端说的「还没有产物」，reason 一定在。
   */
  if (!props.derived.available) {
    return <p className="text-muted-foreground text-xs">{props.derived.reason}</p>
  }

  const lines = treeLinesOf(props.derived, props.controls)
  const tree = lines.filter((line) => line.kind !== "extra")
  const extras = lines.filter((line) => line.kind === "extra")

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">布局树</span>
        <span className="text-muted-foreground text-xs">
          布局那一步推出来的分区 → 组（装着东西的格子，可以再套）→ 控件；点一行，它盖住的控件在画布上描出来。
        </span>
      </div>
      <div className="max-h-80 overflow-auto rounded-md border p-2">
        <div className="flex flex-col gap-1">
          {tree.map((line) => (
            <Line key={line.key} line={line} selected={props.selected} onPick={props.onPick} />
          ))}
        </div>
        {/* 那两块读数各自一块：一行标题（可点）+ 每条的 ref 与原因（原因在悬停提示里）。 */}
        {extras.map((extra) => (
          <div key={extra.key} className="mt-2 flex flex-col gap-1">
            <Line line={extra} selected={props.selected} onPick={props.onPick} />
            {extra.items.map((item, index) => (
              <span
                key={index + ":" + item.ref}
                className="text-muted-foreground text-xs"
                style={{ paddingLeft: indentOf(extra.depth + 1) }}
                title={item.reason}
              >
                {item.label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
