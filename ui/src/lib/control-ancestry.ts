/*
 * 控件层级判定：节点 ref 是 `/` 分隔的层级路径，`357:208031/1066:434323/1066:429780`。
 * 一个整体控件（如 ComboBox）内部的子节点随上层一起生成，自己不带映射；这里回答
 * 「某个节点最近的已登记祖先是哪一个」。
 */
export type ControlNode = { ref: string; controlType?: string }

export function mappedAncestorOf(ref: string, byRef: Map<string, ControlNode>): ControlNode | null {
  let cursor = ref
  while (true) {
    const cut = cursor.lastIndexOf("/")
    if (cut < 0) return null
    cursor = cursor.slice(0, cut)
    const ancestor = byRef.get(cursor)
    if (ancestor?.controlType) return ancestor
  }
}
