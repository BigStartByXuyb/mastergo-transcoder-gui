import { useCallback, useEffect, useRef, useState } from "react"

import { useValueRunner } from "@/app/use-action-runner"
import { useAlive } from "@/app/use-alive"
import { api, type LayoutControl, type LayoutGroup } from "@/lib/api"

/*
 * 布局确认的数据动作：读控件清单与现有分组、叫 AI 出候选、把分组写回去并从布局那一步续跑。
 * 面板（app/layout-panel.tsx）只管开关与渲染；分组的增删改是 ui/src/lib/layout-edit.ts 的纯逻辑；
 * 写回校验与「哪些算可用」的判据在后端 lib/layout-groups.js。
 */

export type LayoutGroupsInput = {
  taskId: string
  /** 流水线直跑 / 孤儿条目没有 taskId，靠 runId 续跑。 */
  runId: string
  /**
   * 有没有可续跑的来源运行：看板任务 / 流水线直跑的条目有（写入后从布局那一步续跑）；
   * 待确认页「手填工程目录」那种没有来源运行，只能把表写进工程（resume=false）。
   */
  resume: boolean
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
  const [canSuggest, setCanSuggest] = useState(false)
  const [autoPass, setAutoPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")
  const [note, setNote] = useState("")
  const [saved, setSaved] = useState(false)
  const alive = useAlive()
  /*
   * 人在界面上改过分组没有：任务每跑完一步都会刷新一次，刷新时不能把人刚拖好的分组盖回服务端那一份
   * （面板就是让人「先改好、等停点再确认」的）。保存成功之后表就是服务端那一份，回到不脏。
   */
  const dirty = useRef(false)
  /*
   * 改分组只有这一个落点（人拖、AI 出候选都走它）：一次「人/AI 改过」就该被记住 ——
   * 否则任务在跑的时候下一次刷新会把刚改好的分组盖回服务端那一份。
   */
  const applyGroups = useCallback((next: LayoutGroup[]) => {
    dirty.current = true
    setGroups(next)
  }, [])
  const { taskId, runId, resume, projectRoot, target, updatedAt, progressDone } = input
  /*
   * 两个配置，同一份骨架（ui/src/app/use-action-runner.ts）：
   *   run     —— 动作：置「正在做」、清旧错、跑、收尾；
   *   runRead —— 读：不动「正在做」（后台刷新不该让按钮闪一下），失败仍写进同一处 failure。
   * 失败用返回值区分：骨架失败时回 null（它已经把原话写进 failure）。
   */
  const run = useValueRunner({ setWorking: (key) => setBusy(Boolean(key)), setFailure: setFailure })
  const runRead = useValueRunner({ setWorking: () => undefined, setFailure: setFailure })

  const load = useCallback(async () => {
    if (!projectRoot || !target) return
    await runRead(
      "",
      () => Promise.all([api.layoutGroups(projectRoot, target), api.settingsGet()]),
      ([payload, settings]) => {
      if (!alive.current) return
      setAvailable(payload.layout.available)
      setReason(payload.layout.reason)
      setControls(payload.layout.controls)
      if (!dirty.current) setGroups(payload.layout.groups)
      setCanSuggest(payload.layout.canSuggest)
      setAutoPass(Boolean(settings.settings.layoutAutoPass))
      }
    )
  }, [alive, projectRoot, target, runRead])

  useEffect(() => {
    void load()
  }, [load, updatedAt, progressDone])

  /*
   * 「自动通过」是门禁开关：写盘失败要照同页别的失败一样说出来（骨架管），并把开关拨回写盘前的样子 ——
   * 显示成「开着」而落盘还是关，界面说的就和真实门禁反了。
   */
  async function toggleAutoPass(value: boolean) {
    const before = autoPass
    setAutoPass(value)
    const payload = await run("toggle", () => api.settingsSave({ layoutAutoPass: value }))
    // 写盘失败（骨架已把原话写进 failure）要把开关拨回写盘前的样子。
    if (payload === null && alive.current) setAutoPass(before)
  }

  async function suggest() {
    setNote("")
    await run("suggest", () => api.aiLayoutGroups(controls), (payload) => {
      if (!alive.current) return
      if (payload.groups.length > 0) {
        applyGroups(payload.groups)
        return
      }
      // 模型一组都没给也是结论：说一句，别让人以为「点了没反应」（空表就是「本页没有要声明的分组」）。
      setNote("模型没有给出分组：可以自己建组，或直接确认（空表＝本页没有要声明的分组）。")
    })
  }

  /*
   * 写回分组表（写入只有 confirm 这一条路）；有来源运行时从 layout 那一步接着跑。
   * 空数组也照写：那是「本页没有要声明的分组」。
   */
  async function save() {
    setSaved(false)
    await run(
      "save",
      () => api.confirm({ projectRoot, target, taskId, runId, groups, resume }),
      () => {
      if (alive.current) {
        dirty.current = false
        setSaved(true)
      }
      }
    )
  }

  return {
    available,
    reason,
    controls,
    groups,
    setGroups: applyGroups,
    canSuggest,
    autoPass,
    toggleAutoPass,
    suggest,
    save,
    busy,
    failure,
    note,
    saved
  }
}
