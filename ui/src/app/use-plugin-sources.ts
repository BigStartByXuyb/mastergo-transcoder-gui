import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { api, type PluginSources } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 插件来源清单这一半：读一次、换一份（用这份）、选一个目录、或交回按顺序自动。
 * 只管「哪一份插件」这件事；自带那一份的更新（检查/下载）在 use-plugin-update.ts。
 */

export function usePluginSources() {
  const [view, setView] = useState<PluginSources | null>(null)
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState("")

  // 卸载之后迟到的响应不再落状态（首次读取与装完刷新走的是同一个 load）。
  const alive = useRef(true)

  const load = useCallback(async () => {
    try {
      const payload = await api.pluginSources()
      if (!alive.current) return
      setView(payload)
      setFailure("")
    } catch (error) {
      if (!alive.current) return
      setFailure(describeFailure(error))
    }
  }, [])

  useEffect(() => {
    // StrictMode 下会「挂载 → 卸下 → 再挂载」：这里要重新放行，否则首次读取永远被拦掉。
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
  }, [load])

  // 换一份：空串＝回到「按顺序自动」；有任务在跑时后端会拒绝并说明原因。
  const choose = useCallback(async function (path: string, key: string) {
    setBusy(key)
    setFailure("")
    try {
      setView(await api.pluginChoose(path))
      toast.success(path ? "已换用这一份插件" : "已改回按顺序自动找")
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }, [])

  const pickFolder = useCallback(async function () {
    setBusy("pick")
    setFailure("")
    try {
      const picked = await api.pickFolder()
      if (picked.path) await choose(picked.path, "pick")
      else if (picked.reason) toast.info(picked.reason)
    } catch (error) {
      setFailure(describeFailure(error))
    } finally {
      setBusy("")
    }
  }, [choose])

  return { view: view, failure: failure, busy: busy, load: load, choose: choose, pickFolder: pickFolder }
}
