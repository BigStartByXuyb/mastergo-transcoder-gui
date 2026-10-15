import type { ChatSummary } from "@/lib/api"

/*
 * 对话列表按工程目录分段：一条对话的工程目录在新建时就定下来，
 * 列表照它归堆，没绑工程的排最后一段。分段只在这里做，界面只负责画。
 */

export type ChatGroup = { projectRoot: string; chats: ChatSummary[] }

/* 没绑工程的对话统一用这一个名字：段头、顶栏标注都取它。 */
function unboundLabel(): string {
  return "未绑工程目录"
}

export function projectLabel(projectRoot: string): string {
  return projectRoot.trim() || unboundLabel()
}

export function groupByProjectRoot(list: ChatSummary[]): ChatGroup[] {
  const buckets = new Map<string, ChatSummary[]>()
  for (const chat of list) {
    const key = chat.projectRoot || ""
    const bucket = buckets.get(key)
    if (bucket) bucket.push(chat)
    else buckets.set(key, [chat])
  }
  return [...buckets.entries()]
    .map(([projectRoot, chats]) => ({ projectRoot, chats }))
    .sort((left, right) => {
      if (!left.projectRoot) return 1
      if (!right.projectRoot) return -1
      return left.projectRoot.localeCompare(right.projectRoot)
    })
}
