import { useCallback, useEffect, useState } from "react"

import { useAlive } from "@/app/use-alive"
import { api, type LayoutControl, type LayoutGroup } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"

/*
 * 布局确认的数据动作：读控件清单与现有分组、叫 AI 出候选、把分组写回去并从布局那一步续跑。
 * 面板（app/layout-panel.tsx）只管开关与渲染；分组的增删改是 ui/src/lib/layout-edit.ts 的纯逻辑；
 * 写回校验与「哪些算可用」的判据在后端 lib/layout-groups.js。
 */

export type LayoutGroupsInput = {
  taskId: string
  /** 流水线直跑 / 孤儿条目没有 taskId，靠 runId 续跑。 */
  runId: string
  projectRoot: string
  target: string
  /** 用于在任务推进时重读；看板任务给它 updatedAt，待确认页给空串（不轮询）。 */
  updatedAt: string
  progressDone?: number
}

export function useLayoutGroups(input: LayoutGroupsInput) {
  const [available, setAvailable] = useState(false)
  const [reason, setReason] = useState("")
  const [controls, setControls] = useState<LayoutControl[]>([])
  const [groups, setGroups] = useState<LayoutGroup[]>([])
  const [autoPass, setAutoPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")
  const [saved, setSaved] = useState(false)
  const alive = useAlive()
  const { taskId, runId, projectRoot, target, updatedAt, progressDone } = input

  const load = useCallback(async () => {
    if (!projectRoot || !target) return
    try {
      const [payload, settings] = await Promise.all([api.layoutGroups(projectRoot, target), api.settingsGet()])
      if (!alive.current) return
      setAvailable(payload.layout.available)
      setReason(payload.layout.reason)
      setControls(payload.layout.controls)
      setGroups(payload.layout.groups)
      setAutoPass(Boolean(settings.settings.layoutAutoPass))
    } catch (error) {
      if (alive.current) setFailure(describeFailure(error))
    }
  }, [alive, projectRoot, target])

  useEffect(() => {
    void load()
  }, [load, updatedAt, progressDone])

  /*
   * 「自动通过」是门禁开关：写盘失败要照同页别的失败一样说出来，并把开关拨回写盘前的样子 ——
   * 显示成「开着」而落盘还是关，界面说的就和真实门禁反了。
   */
  async function toggleAutoPass(value: boolean) {
    const before = autoPass
    setAutoPass(value)
    setFailure("")
    try {
      await api.settingsSave({ layoutAutoPass: value })
    } catch (error) {
      if (!alive.current) return
      setAutoPass(before)
      setFailure(describeFailure(error))
    }
  }

  async function suggest() {
    if (controls.length < 2) return
    setBusy(true)
    setFailure("")
    try {
      const payload = await api.aiLayoutGroups(controls)
      if (alive.current && payload.groups.length > 0) setGroups(payload.groups)
    } catch (error) {
      if (alive.current) setFailure(describeFailure(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  // 写回分组表并从 layout 续跑（写入只有 confirm 这一条路）。空数组也照写：本页没有要声明的分组。
  async function save() {
    setBusy(true)
    setFailure("")
    setSaved(false)
    try {
      await api.confirm({ projectRoot, target, taskId, runId, groups, resume: true })
      if (alive.current) setSaved(true)
    } catch (error) {
      if (alive.current) setFailure(describeFailure(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return {
    available,
    reason,
    controls,
    groups,
    setGroups,
    autoPass,
    toggleAutoPass,
    suggest,
    save,
    busy,
    failure,
    setFailure,
    saved
  }
}
