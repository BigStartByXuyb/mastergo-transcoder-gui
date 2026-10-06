import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { useValueRunner } from "@/app/use-action-runner"
import { api, type PluginSources } from "@/lib/api"

/*
 * 插件来源清单这一半：读一次、换一份（用这份）、选一个目录、或交回按顺序自动。
 * 只管「哪一份插件」这件事；自带那一份的更新（检查/下载）在 use-plugin-update.ts。
 */

export function usePluginSources() {
  const [view, setView] = useState<PluginSources | null>(null)
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState("")

  // 动作骨架与四张卡同一处（use-action-runner 的 useValueRunner）：置 busy → 清旧错 → 跑 → 收尾。
  const act = useValueRunner({ setWorking: setBusy, setFailure: setFailure })

  // 卸载之后迟到的响应不再落状态（首次读取与装完刷新走的是同一个 load）。
  const alive = useRef(true)

  const load = useCallback(async () => {
    // 首次读取与装完刷新都走这一条：读失败的说法与别处同一处口径（describeFailure）。
    await act("load", async () => {
      const payload = await api.pluginSources()
      if (alive.current) setView(payload)
      return payload
    })
  }, [act])

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
    await act(
      key,
      () => api.pluginChoose(path),
      (payload) => {
        setView(payload)
        toast.success(path ? "已换用这一份插件" : "已改回按顺序自动找")
      }
    )
  }, [act])

  const pickFolder = useCallback(async function () {
    await act("pick", async () => {
      const picked = await api.pickFolder()
      // 选了目录就换过去（同一条换一份的路）；取消或没弹出就照它的话说一句。
      if (picked.path) await choose(picked.path, "pick")
      else if (picked.reason) toast.info(picked.reason)
      return picked
    })
  }, [act, choose])

  return { view: view, failure: failure, busy: busy, load: load, choose: choose, pickFolder: pickFolder }
}
