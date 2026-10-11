import type { LayoutControl, LayoutTreeNode } from "@/lib/api"
import { numberOf } from "@/lib/layout-edit"
import { cn } from "@/lib/utils"

/*
 * 布局确认里的层次图：把设计稿里「放着控件的那些段」按层级摆出来。
 * 点一段，把这一段（连同它下面的段）里的控件 ref 交给调用方（画布据此描边）——
 * 「谁被选中」由调用方一处持有（这里不另存一份），换页时跟着一起清。
 * 号由 numberOf 现算（「控件号＝它在清单里的次序」只有那一处实现），与画布、与面上清单同源。
 */

/* 这一段自己加上它下面所有段里的控件（画布按 ref 描边）。 */
function refsOf(node: LayoutTreeNode, controls: LayoutControl[]): string[] {
  const out = numberOf(controls, node.ref) > 0 ? [node.ref] : []
  for (const child of node.children) out.push(...refsOf(child, controls))
  return out
}

/*
 * 一段在树上叫什么：
 *   控件 —— 名字（没有就类型）带上它的号；
 *   容器 —— 只说方向（横排 / 竖排 / 自由布局）：设计稿里的层名（「容器 194」这种）没有信息量，
 *   真要找它原始那层叫什么，鼠标停上去的提示里有（title）。
 */
const FLOW_LABEL: Record<string, string> = { row: "横排", column: "竖排", "": "自由布局" }

function nodeLabel(node: LayoutTreeNode, controls: LayoutControl[]): string {
  const number = numberOf(controls, node.ref)
  if (number > 0) return (node.name || node.type || node.ref) + " · #" + number
  return FLOW_LABEL[node.flow]
}

export function LayoutTree(props: {
  nodes: LayoutTreeNode[]
  controls: LayoutControl[]
  /** 现在选中的是哪一段（调用方持有；空串＝没选）。 */
  selected: string
  /** 点了一段：把 ref 与「这一段连同下面各段里的控件 ref」一起回给调用方。 */
  onPick: (ref: string, refs: string[]) => void
}) {
  if (props.nodes.length === 0) return null

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">层次图</span>
        <span className="text-muted-foreground text-xs">点一段：它里面的控件在画布上描出来，再点一下取消。</span>
      </div>
      <div className="max-h-80 overflow-auto rounded-md border p-2">
        <Branch
          nodes={props.nodes}
          controls={props.controls}
          depth={0}
          selected={props.selected}
          onPick={(node) => props.onPick(node.ref, refsOf(node, props.controls))}
        />
      </div>
    </div>
  )
}

function Branch(props: {
  nodes: LayoutTreeNode[]
  controls: LayoutControl[]
  depth: number
  selected: string
  onPick: (node: LayoutTreeNode) => void
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {props.nodes.map((node) => (
        <li key={node.ref} className="flex flex-col gap-0.5">
          <button
            type="button"
            title={node.name ? node.name + "（" + node.ref + "）" : node.ref}
            data-selected={props.selected === node.ref}
            onClick={() => props.onPick(node)}
            className={cn(
              "rounded px-1 py-0.5 text-left text-xs hover:bg-accent",
              props.selected === node.ref && "bg-accent text-accent-foreground",
              numberOf(props.controls, node.ref) > 0 ? "text-foreground" : "text-muted-foreground"
            )}
            style={{ paddingLeft: 4 + props.depth * 12 }}
          >
            {nodeLabel(node, props.controls)}
          </button>
          {node.children.length > 0 && (
            <Branch
              nodes={node.children}
              controls={props.controls}
              depth={props.depth + 1}
              selected={props.selected}
              onPick={props.onPick}
            />
          )}
        </li>
      ))}
    </ul>
  )
}
