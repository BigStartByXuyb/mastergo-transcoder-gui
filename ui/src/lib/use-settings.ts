import { useCallback, useEffect, useState } from "react"

import { api, type Settings } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 设置页各子页共用的读写口：读一次、存一次、错了给一句可读的话。
 *
 * 子页一次只挂载一个，所以同一时刻只有一份在请求；各子页自己不再各写一套取数逻辑，
 * 否则「读失败怎么说」「存完怎么同步」会在几个页面里各写一遍、各偏一点。
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [failure, setFailure] = useState("")

  useEffect(() => {
    let stopped = false
    api
      .settingsGet()
      .then((payload) => {
        if (stopped) return
        setSettings(payload.settings)
        setFailure("")
      })
      .catch((error) => {
        if (!stopped) setFailure(describeFailure(error))
      })
    return () => {
      stopped = true
    }
  }, [])

  const save = useCallback(async (patch: unknown) => {
    const payload = await api.settingsSave(patch)
    setSettings(payload.settings)
    return payload.settings
  }, [])

  return { settings: settings, failure: failure, save: save }
}
