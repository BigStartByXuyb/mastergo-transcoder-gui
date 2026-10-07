import { useCallback, useMemo, useRef } from "react"

/*
 * 记住「最近一次失败的原话」，同时把它写回界面。
 *
 * 为什么单开一处：动作骨架（app/use-action-runner）只把失败写进状态，而「保存并检查」那一下
 * 要把同一句话原样交给弹窗 —— 程序更新与插件两半都要这件事，记忆时机因此只写这一份。
 */
export function useFailureMemory(setFailure: (message: string) => void) {
  const ref = useRef("")
  // setter 放 ref 里：remember 因此是稳定的（不清进依赖里，也不跟着重渲染换）。
  const latest = useRef(setFailure)
  latest.current = setFailure
  const remember = useCallback(function (message: string) {
    ref.current = message
    latest.current(message)
  }, [])
  /*
   * 交出去的这一份对象也稳定：调用方把它列进 useCallback 的依赖（「动作函数是稳定的」靠这条），
   * 每次渲染都新建对象会让那边每渲染一次就换一套动作函数。
   */
  return useMemo(
    function () {
      return { remember: remember, last: function () { return ref.current } }
    },
    [remember]
  )
}
