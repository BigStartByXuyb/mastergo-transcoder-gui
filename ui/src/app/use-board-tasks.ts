import { useCallback, useEffect, useState } from "react"

import { api, type Board, type BoardTask } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { POLL_MS } from "@/lib/task-state"

/*
 * 看板快照：任务的唯一登记。取一次 + 按节拍轮询，并且给一个「动作回来之后直接换掉这份快照」的入口
 * （后端每个动作都回最新的看板，不必再取一次）。
 * 界面不自己推任务状态 —— 所有状态都从这份快照读。
 * 取不到时把原因写在 problem 上（轮询失败保留上一份数据：界面不该因为一次抖动就空掉）；
 * 看板这一页的动作失败也写同一个 problem —— 一条线一句提示，界面只挂一处横幅。
 */

export function useBoardTasks() {
  const [board, setBoard] = useState<Board | null>(null)
  const [problem, setProblem] = useState("")

  const reload = useCallback(
    () =>
      api
        .board()
        .then((payload) => {
          setBoard(payload.board)
          setProblem("")
        })
        .catch((error) => setProblem(describeFailure(error))),
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
    problem,
    setProblem,
    tasks: board?.tasks ?? [],
    taskOf: (taskId: string): BoardTask | null => (board?.tasks ?? []).find((item) => item.id === taskId) ?? null
  }
}
