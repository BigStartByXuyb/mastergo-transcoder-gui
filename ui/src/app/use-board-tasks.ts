import { useCallback, useEffect, useState } from "react"

import { api, type Board, type BoardTask } from "@/lib/api"
import { POLL_MS } from "@/lib/task-state"

/*
 * 看板快照：任务的唯一登记。取一次 + 按节拍轮询，并且给一个「动作回来之后直接换掉这份快照」的入口
 * （后端每个动作都回最新的看板，不必再取一次）。
 * 界面不自己推任务状态 —— 所有状态都从这份快照读。
 */

export function useBoardTasks() {
  const [board, setBoard] = useState<Board | null>(null)

  const reload = useCallback(
    () =>
      api
        .board()
        .then((payload) => setBoard(payload.board))
        .catch(() => undefined),
    []
  )

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [reload])

  return {
    board,
    setBoard,
    reload,
    tasks: board?.tasks ?? [],
    taskOf: (taskId: string): BoardTask | null => (board?.tasks ?? []).find((item) => item.id === taskId) ?? null
  }
}
