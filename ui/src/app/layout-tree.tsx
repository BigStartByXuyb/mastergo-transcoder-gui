import { useState } from "react"

import type { LayoutTreeNode } from "@/lib/api"
import { cn } from "@/lib/utils"

/*
 * 布局确认里的层次图：把设计稿里「放着控件的那些段」按层级摆出来。
 * 点一段，就把这一段（连同它下面的段）里的控件在画布上描出来 —— 号与画布、与面上清单同源
 * （号由后端按同一份清单的次序算，这里只显示）。
 * 选中态只在这里：一次选一段，再点一下取消（不往面板外传，面板只收「要描哪几个控件」）。
 */

/* 这一段自己加上它下面所有段里的控件（画布按 ref 描边）。 */
function refsOf(node: LayoutTreeNode): string[] {
  const out = node.numbers.length > 0 ? [node.ref] : []
  for (const child of node.children) out.push(...refsOf(child))
  return out
}

/* 一段在树上叫什么：有名字用名字，没有就用类型；再带上这一段自己放着的号。 */
function nodeLabel(node: LayoutTreeNode): string {
  const head = node.name || node.type || node.ref
  return node.numbers.length > 0 ? head + " · #" + node.numbers.join(" #") : head
}

export function LayoutTree(props: { nodes: LayoutTreeNode[]; onPick: (refs: string[]) => void }) {
  const [selected, setSelected] = useState("")

  function pick(node: LayoutTreeNode) {
    const next = selected === node.ref ? "" : node.ref
    setSelected(next)
    props.onPick(next ? refsOf(node) : [])
  }

  if (props.nodes.length === 0) return null

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">层次图</span>
        <span className="text-muted-foreground text-xs">点一段：它里面的控件在画布上描出来，再点一下取消。</span>
      </div>
      <div className="max-h-80 overflow-auto rounded-md border p-2">
        <Branch nodes={props.nodes} depth={0} selected={selected} onPick={pick} />
      </div>
    </div>
  )
}

function Branch(props: {
  nodes: LayoutTreeNode[]
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
            title={node.ref}
            onClick={() => props.onPick(node)}
            className={cn(
              "rounded px-1 py-0.5 text-left text-xs hover:bg-accent",
              props.selected === node.ref && "bg-accent text-accent-foreground",
              node.numbers.length > 0 ? "text-foreground" : "text-muted-foreground"
            )}
            style={{ paddingLeft: 4 + props.depth * 12 }}
          >
            {nodeLabel(node)}
          </button>
          {node.children.length > 0 && (
            <Branch nodes={node.children} depth={props.depth + 1} selected={props.selected} onPick={props.onPick} />
          )}
        </li>
      ))}
    </ul>
  )
}
