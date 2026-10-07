import { useCallback, useRef } from "react"

/*
 * 记住「最近一次失败的原话」，同时把它写回界面。
 *
 * 为什么单开一处：动作骨架（app/use-action-runner）只把失败写进状态，而「保存并检查」那一下
 * 要把同一句话原样交给弹窗 —— 程序更新与插件两半都要这件事，记忆时机因此只写这一份。
 */
export function useFailureMemory(setFailure: (message: string) => void) {
  const ref = useRef("")
  const remember = useCallback(
    function (message: string) {
      ref.current = message
      setFailure(message)
    },
    [setFailure]
  )
  return { remember: remember, last: function () { return ref.current } }
}
