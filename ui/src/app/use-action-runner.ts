import { useCallback, useRef } from "react"
import { toast } from "sonner"

import { describeFailure } from "@/lib/describe-failure"

/*
 * 卡片上的动作都走这一条：置 working → 清旧错 → 跑 → 套用返回的状态 → 提示 → 收尾（复位 working）。
 *
 * 四张卡（程序更新、Codex 引擎、运行时、插件安装）共用同一份骨架；各自只给「怎么跑」与
 * 「跑完说什么」（给一句话，或给一个按结果决定说法的函数）。
 * 结果里不带 `{status}` 的动作（插件发布源弹窗里的「保存」「保存并检查」）走 useValueRunner：
 * 骨架是同一份，差别只在「跑完怎么用返回值」—— 那边把整份结果交给调用方。
 * 三个 setter 放 ref 里：返回的动作函数是稳定的，不跟着组件重渲染换。
 */

type RunnerSettings = {
  setWorking: (key: string) => void
  setFailure: (message: string) => void
}

export type ActionRunner<T> = <R extends { status: T | null }>(
  key: string,
  run: () => Promise<R>,
  done?: string | ((payload: R) => void)
) => Promise<R | null>

export type ValueRunner = <R>(key: string, run: () => Promise<R>, done?: (payload: R) => void) => Promise<R | null>

/** 结果原样交给调用方的那一条：骨架与 useActionRunner 同一份实现（前者是后者的壳）。 */
export function useValueRunner(settings: RunnerSettings): ValueRunner {
  const latest = useRef(settings)
  latest.current = settings

  return useCallback(async function <R>(
    key: string,
    run: () => Promise<R>,
    done?: (payload: R) => void
  ): Promise<R | null> {
    latest.current.setWorking(key)
    latest.current.setFailure("")
    try {
      const payload = await run()
      if (done) done(payload)
      return payload
    } catch (error) {
      latest.current.setFailure(describeFailure(error))
      return null
    } finally {
      latest.current.setWorking("")
    }
  }, [])
}

export function useActionRunner<T>(settings: RunnerSettings & { setStatus: (status: T) => void }): ActionRunner<T> {
  const value = useValueRunner(settings)
  const latest = useRef(settings)
  latest.current = settings

  return useCallback(async function <R extends { status: T | null }>(
    key: string,
    run: () => Promise<R>,
    done?: string | ((payload: R) => void)
  ): Promise<R | null> {
    return await value(key, run, function (payload) {
      // 状态可能是 null（下载那类接口会把上一次的结果留在里面），有才套用。
      if (payload.status) latest.current.setStatus(payload.status)
      if (typeof done === "function") done(payload)
      else if (done) toast.success(done)
    })
  }, [value])
}
