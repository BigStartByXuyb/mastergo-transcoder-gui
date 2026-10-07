import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { useAlive } from "@/app/use-alive"
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

  // 卸载之后迟到的响应不再落状态（首次读取与装完刷新走的是同一个 load）；守卫本身在 app/use-alive。
  const alive = useAlive()

  const load = useCallback(async () => {
    // 首次读取与装完刷新都走这一条：读失败的说法与别处同一处口径（describeFailure）。
    await act("load", async () => {
      const payload = await api.pluginSources()
      if (alive.current) setView(payload)
      return payload
    })
  }, [act])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * 换一份之后的收尾：把新清单落到界面、说一句。
   * 「用这份」那颗按钮与「指定一个目录…」选完目录是同一种收尾，只写这一处（path 为空＝交回自动）。
   */
  const adoptChosen = useCallback(function (payload: PluginSources, path: string) {
    setView(payload)
    toast.success(path ? "已换用这一份插件" : "已改回按顺序自动找")
  }, [])

  // 换一份：空串＝回到「按顺序自动」；有任务在跑时后端会拒绝并说明原因。
  const choose = useCallback(
    async function (path: string, key: string) {
      await act(key, () => api.pluginChoose(path), (payload) => adoptChosen(payload, path))
    },
    [act, adoptChosen]
  )

  const pickFolder = useCallback(async function () {
    // 一次点击＝一个动作：选目录与换过去在同一层骨架里（不在骨架里再套一层骨架）。
    await act("pick", async () => {
      const picked = await api.pickFolder()
      // 取消或没弹出选择框：照它的话说一句，什么都不换。
      if (!picked.path) {
        if (picked.reason) toast.info(picked.reason)
        return null
      }
      const payload = await api.pluginChoose(picked.path)
      adoptChosen(payload, picked.path)
      return payload
    })
  }, [act, adoptChosen])

  return { view: view, failure: failure, busy: busy, load: load, choose: choose, pickFolder: pickFolder }
}
