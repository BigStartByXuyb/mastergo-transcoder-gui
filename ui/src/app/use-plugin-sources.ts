import { useCallback, useEffect, useState } from "react"

import { useAlive } from "@/app/use-alive"
import { useValueRunner } from "@/app/use-action-runner"
import { api, type PluginSources } from "@/lib/api"
import { PLUGIN_BUSY } from "@/lib/plugin-busy"

/*
 * 插件来源清单这一半：读一次（插件装在哪儿、是哪一版）。
 * 只管「插件在哪」这件事；那一份的更新（检查/下载）在 use-plugin-update.ts。
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
    await act(PLUGIN_BUSY.load, async () => {
      const payload = await api.pluginSources()
      if (alive.current) setView(payload)
      return payload
    })
  }, [act])

  // 手动切换来源：后端写回 override 并重定位插件，返回的新清单直接落状态。
  const override = useCallback(
    async (id: string) => {
      await act(PLUGIN_BUSY.load, async () => {
        const payload = await api.pluginOverride(id)
        if (alive.current) setView(payload)
        return payload
      })
    },
    [act]
  )

  useEffect(() => {
    void load()
  }, [load])

  return { view: view, failure: failure, busy: busy, load: load, override: override }
}
