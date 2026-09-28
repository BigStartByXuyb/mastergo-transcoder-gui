import { useCallback, useEffect, useRef, useState } from "react"
import { CheckCircle2, Loader2, RefreshCw, Send, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiFailure, api, type Pending } from "@/lib/api"

const BASIS_LABEL: Record<string, string> = {
  "host-shell": "宿主外壳自带",
  "icon-policy-none": "映射表登记为不登记",
  "icon-policy-runtime": "运行时决定",
  "bottom-bar-resident": "底部栏常驻",
  "bottom-bar-menu-item": "底部栏菜单项",
  "icon-policy-single-path": "单 PATH 图标",
  "camera-viewport-internal": "相机视图内部",
  "no-icon-slot": "无图标槽位"
}

function describe(error: unknown): string {
  if (error instanceof ApiFailure) return error.message + (error.hint ? "：" + error.hint : "")
  return String(error instanceof Error ? error.message : error)
}

export type PendingPanelHandle = { reload: () => void }

/*
 * 待确认面板：列出流水线停下来要补的语义输入，可以叫 AI 出候选，确认后从断点续跑。
 *
 * 自动化层级（来自设置）：
 *   off   —— 只列清单，不叫模型
 *   assist—— 自动叫模型出候选并预填，等人确认（默认）
 *   auto  —— 自动叫模型，拿到候选直接提交并续跑（人可在日志里回看）
 */
export function PendingPanel({
  projectRoot,
  target,
  runId,
  reloadKey,
  automation,
  onResumed,
  onState
}: {
  projectRoot: string
  target: string
  runId: string
  /** 运行状态指纹（如 `<jobId>:<state>`）。状态变化要重读清单——否则「跑着 → 停下」后看不见新出现的待办。 */
  reloadKey?: string
  automation: string
  onResumed?: () => void
  onState?: (state: { waiting: number; phase: string }) => void
}) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [names, setNames] = useState<Record<number, { name: string; comment: string }>>({})
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [glossary, setGlossary] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const [allowEmptyLedger, setAllowEmptyLedger] = useState(true)
  const [aiReady, setAiReady] = useState<boolean | null>(null)
  const autoKey = useRef("")

  // 没配模型就别去撞错误：直接说明白，让人工填这条路照常可用。
  useEffect(() => {
    api
      .settingsGet()
      .then((payload) => setAiReady(payload.settings.ai.hasKey && Boolean(payload.settings.ai.baseUrl) && Boolean(payload.settings.ai.model)))
      .catch(() => setAiReady(false))
  }, [])

  const load = useCallback(async () => {
    if (!projectRoot.trim() || !target.trim()) return
    setBusy("load")
    setFailure("")
    try {
      const payload = await api.pending(projectRoot, target)
      setPending(payload.pending)
      setNames((current) => {
        const next = { ...current }
        for (const item of payload.pending.icons.mustName) {
          if (!next[item.index]) next[item.index] = { name: "", comment: "" }
        }
        for (const row of payload.pending.icons.naming) next[row.index] = { name: row.name ?? "", comment: row.comment ?? "" }
        return next
      })
      setTexts((current) => {
        const next = { ...current }
        for (const item of payload.pending.translations.pendingTranslations) {
          if (next[item.text] === undefined) next[item.text] = payload.pending.translations.translations[item.text] ?? ""
        }
        return next
      })
      setGlossary((current) => {
        const next = { ...current }
        for (const item of payload.pending.translations.glossaryRequired) {
          if (next[item.text] === undefined) next[item.text] = payload.pending.translations.glossary[item.text] ?? ""
        }
        return next
      })
    } catch (error) {
      setFailure(describe(error))
    } finally {
      setBusy("")
    }
    // runId / 运行状态变化都要重读：换了一次运行，或者同一次运行从"跑着"变成"停下"。
  }, [projectRoot, target, runId, reloadKey])

  useEffect(() => {
    void load()
  }, [load])

  const iconTotal = pending?.icons.available ? pending.icons.mustName.length : 0
  const iconCount = pending?.icons.available ? pending.icons.missing : 0
  const langCount =
    pending?.translations.available && pending.translations.needsTranslation
      ? pending.translations.pendingTranslations.length
      : 0
  const glossaryCount =
    pending?.translations.available && pending.translations.needsGlossary
      ? pending.translations.glossaryRequired.length
      : 0
  const waiting = iconCount + langCount + glossaryCount

  useEffect(() => {
    onState?.({ waiting, phase: busy })
  }, [waiting, busy, onState])

  const namingPayload = useCallback(
    () =>
      (pending?.icons.mustName ?? []).map((item) => ({
        index: item.index,
        name: names[item.index]?.name ?? "",
        comment: names[item.index]?.comment ?? "",
        // 整页几何的条目由后端的机械判定决定（sourceId 指向页面根），不由模型猜。
        ...(item.sourceIsPageRoot ? { fromDsl: true } : {})
      })),
    [pending, names]
  )

  const translationsPayload = useCallback(() => {
    const out: Record<string, string> = {}
    for (const item of pending?.translations.pendingTranslations ?? []) {
      const value = texts[item.text]
      if (value && value.trim()) out[item.text] = value.trim()
    }
    return out
  }, [pending, texts])

  const glossaryPayload = useCallback(() => {
    const out: Record<string, string> = {}
    for (const item of pending?.translations.glossaryRequired ?? []) {
      const value = glossary[item.text]
      if (value && value.trim()) out[item.text] = value.trim()
    }
    return out
  }, [pending, glossary])

  // 显式接收入参：自动路径拿的是「刚取回的候选」，等 setState 生效再读会拿到空值。
  const submitWith = useCallback(
    async (
      resume: boolean,
      naming: { index: number; name: string; comment: string; fromDsl?: boolean }[],
      translations: Record<string, string>,
      glossaryMap: Record<string, string>
    ) => {
      if (!pending) return
      setBusy("submit")
      setFailure("")
      try {
        const payload = await api.confirm({
          projectRoot: pending.projectRoot,
          target: pending.target,
          runId,
          naming: pending.icons.available && pending.icons.needsNaming ? naming : undefined,
          translations: pending.translations.available ? translations : undefined,
          glossary: pending.translations.available ? glossaryMap : undefined,
          allowEmptyLedger: pending.icons.available && !pending.icons.needsNaming ? allowEmptyLedger : false,
          resume
        })
        const summary = payload.written.map((item) => item.path.split(/[\\/]/).pop() + "（" + item.count + " 条）").join("、")
        toast.success("已写入：" + (summary || "无") + (payload.job ? "，已从断点继续" : ""))
        await load()
        if (payload.job) onResumed?.()
      } catch (error) {
        setFailure(describe(error))
      } finally {
        setBusy("")
      }
    },
    [pending, runId, allowEmptyLedger, load, onResumed]
  )

  const submit = useCallback(
    (resume: boolean) => submitWith(resume, namingPayload(), translationsPayload(), glossaryPayload()),
    [submitWith, namingPayload, translationsPayload, glossaryPayload]
  )

  /*
   * 自动出候选：同一个停点只自动跑一次。
   * 关键在 autoKey —— 用「工程 + 页面 + 待办条数」做指纹，续跑后条数变了才会再来一轮，
   * 否则每次重渲染都会重复打模型。
   */
  useEffect(() => {
    if (!pending || automation === "off") return
    if (waiting === 0) return
    if (aiReady !== true) return
    const key = projectRoot + "|" + target + "|" + iconCount + "|" + langCount + "|" + glossaryCount
    if (autoKey.current === key) return
    autoKey.current = key
    void (async () => {
      setBusy("ai")
      try {
        let naming = namingPayload()
        let translations = translationsPayload()
        let glossaryMap = glossaryPayload()
        if (iconCount > 0) {
          const payload = await api.aiIconNames(pending.icons.mustName)
          const patch: Record<number, { name: string; comment: string }> = {}
          for (const item of payload.items) patch[item.index] = { name: item.name, comment: item.comment }
          setNames((current) => ({ ...current, ...patch }))
          naming = pending.icons.mustName.map((item) => ({
            index: item.index,
            name: patch[item.index]?.name ?? "",
            comment: patch[item.index]?.comment ?? "",
            ...(item.sourceIsPageRoot ? { fromDsl: true } : {})
          }))
          toast.success("AI 出了 " + payload.items.length + " 条图标名")
        }
        if (langCount > 0) {
          const payload = await api.aiTranslations(pending.translations.pendingTranslations.map((item) => item.text))
          const patch: Record<string, string> = {}
          for (const item of payload.items) patch[item.text] = item.translation
          setTexts((current) => ({ ...current, ...patch }))
          translations = {}
          for (const item of pending.translations.pendingTranslations) {
            const value = patch[item.text]
            if (value && value.trim()) translations[item.text] = value.trim()
          }
          toast.success("AI 出了 " + payload.items.length + " 条译文")
        }
        if (glossaryCount > 0) {
          const payload = await api.aiGlossary(pending.translations.glossaryRequired.map((item) => item.text))
          const patch: Record<string, string> = {}
          for (const item of payload.items) patch[item.text] = item.identifier
          setGlossary((current) => ({ ...current, ...patch }))
          glossaryMap = {}
          for (const item of pending.translations.glossaryRequired) {
            const value = patch[item.text]
            if (value && value.trim()) glossaryMap[item.text] = value.trim()
          }
          toast.success("AI 出了 " + payload.items.length + " 条术语")
        }
        // 自动层级：出完候选直接提交并续跑，人只需要在日志里回看。
        if (automation === "auto") await submitWith(true, naming, translations, glossaryMap)
      } catch (error) {
        // 模型不可用不该把人挡住：退回人工填，把原因写在面板上。
        setFailure("AI 出候选失败（可以人工填）：" + describe(error))
      } finally {
        setBusy("")
      }
    })()
  }, [
    pending,
    automation,
    waiting,
    iconCount,
    langCount,
    glossaryCount,
    projectRoot,
    target,
    aiReady,
    namingPayload,
    translationsPayload,
    glossaryPayload,
    submitWith
  ])

  async function suggestNamesOnly() {
    if (!pending) return
    setBusy("ai-icons")
    try {
      const payload = await api.aiIconNames(pending.icons.mustName)
      setNames((current) => {
        const next = { ...current }
        for (const item of payload.items) next[item.index] = { name: item.name, comment: item.comment }
        return next
      })
      toast.success("已填入 " + payload.items.length + " 条")
    } catch (error) {
      setFailure("AI 出候选失败（可以人工填）：" + describe(error))
    } finally {
      setBusy("")
    }
  }

  async function suggestTextsOnly() {
    if (!pending) return
    setBusy("ai-lang")
    try {
      const payload = await api.aiTranslations(pending.translations.pendingTranslations.map((item) => item.text))
      setTexts((current) => {
        const next = { ...current }
        for (const item of payload.items) next[item.text] = item.translation
        return next
      })
      toast.success("已填入 " + payload.items.length + " 条")
    } catch (error) {
      setFailure("AI 出候选失败（可以人工填）：" + describe(error))
    } finally {
      setBusy("")
    }
  }

  if (!pending) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        {busy === "load" && <Loader2 className="size-4 animate-spin" />}
        {failure ? failure : "读取待确认清单…"}
      </div>
    )
  }

  const icons = pending.icons
  const lang = pending.translations

  return (
    <div className="flex flex-col gap-4">
      {failure && (
        <Alert variant="destructive">
          <AlertDescription className="break-all">{failure}</AlertDescription>
        </Alert>
      )}

      {waiting > 0 && aiReady === false && automation !== "off" && (
        <Alert>
          <AlertTitle>还没配模型，暂时只能人工填</AlertTitle>
          <AlertDescription>
            到「设置」填厂商 / base_url / 模型名 / key 之后，这里会自动出候选。下面仍然可以手填。
          </AlertDescription>
        </Alert>
      )}

      {icons.available && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">图标命名</span>
            <span className="text-muted-foreground text-xs">「要不要登记」由插件判定；这里只补名字</span>
            {iconTotal > 0 && (
              <Badge variant={iconCount > 0 ? "secondary" : "outline"}>
                已填 {iconTotal - iconCount} / {iconTotal}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {icons.registrationSummary && <Badge variant="secondary">需登记 {icons.registrationSummary.register}</Badge>}
            {icons.registrationSummary && <Badge variant="outline">不登记 {icons.registrationSummary.skip}</Badge>}
            {icons.registrationSummary &&
              Object.entries(icons.registrationSummary.byBasis).map(([basis, count]) => (
                <Badge key={basis} variant="outline">
                  {BASIS_LABEL[basis] ?? basis} {count}
                </Badge>
              ))}
          </div>

          {!icons.needsNaming && (
            <>
              <Alert>
                <AlertTitle>本页没有要登记的图标</AlertTitle>
                <AlertDescription>
                  候选 {icons.candidates.length} 条全部由插件判定为无需登记。这种情况插件要求显式声明空台账，
                  而不是写一份空的命名表。
                </AlertDescription>
              </Alert>
              <div className="flex items-center gap-2">
                <Switch id="allow-empty-ledger" checked={allowEmptyLedger} onCheckedChange={setAllowEmptyLedger} />
                <Label htmlFor="allow-empty-ledger">确认本页没有图标槽位，按空台账继续（-AllowEmptyLedger）</Label>
              </div>
            </>
          )}

          {icons.needsNaming && (
            <>
              <div>
                <Button variant="outline" size="sm" disabled={busy !== ""} onClick={() => void suggestNamesOnly()}>
                  {busy === "ai-icons" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  让 AI 重新出候选名
                </Button>
              </div>
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>图标 / 归属</TableHead>
                      <TableHead className="w-52">资源名</TableHead>
                      <TableHead className="w-52">中文注释</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {icons.mustName.map((item) => (
                      <TableRow key={item.index}>
                        <TableCell className="text-muted-foreground text-xs">
                          <div className="flex items-center gap-1">
                            {item.filled && <CheckCircle2 className="size-3.5 text-emerald-600" />}
                            {item.index}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">{item.svgName || item.nodeName || "(未命名图层)"}</div>
                          <div className="text-muted-foreground text-xs">
                            {item.ownerControlType ? item.ownerControlType + " · " : ""}
                            {item.ownerText || "无归属文本"}
                            {item.ledgerFields?.iconSize
                              ? " · " + item.ledgerFields.iconSize.width + "×" + item.ledgerFields.iconSize.height
                              : ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            spellCheck={false}
                            placeholder="SetGeometry"
                            value={names[item.index]?.name ?? ""}
                            onChange={(event) =>
                              setNames((current) => ({
                                ...current,
                                [item.index]: { name: event.target.value, comment: current[item.index]?.comment ?? "" }
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={names[item.index]?.comment ?? ""}
                            onChange={(event) =>
                              setNames((current) => ({
                                ...current,
                                [item.index]: { name: current[item.index]?.name ?? "", comment: event.target.value }
                              }))
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      )}

      {lang.available && (
        <div className="flex flex-col gap-3">
          {lang.needsGlossary && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">术语表</span>
                <Badge variant="destructive">必须补 {lang.glossaryRequired.length}</Badge>
                <span className="text-muted-foreground text-xs">
                  这些文案派生不出语义键（单字符之类），要给英文标识符；同一含义跨页面必须一致
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {lang.glossaryRequired.map((item) => (
                  <div key={item.key} className="flex flex-col gap-1">
                    <Label className="text-muted-foreground text-xs">
                      {item.text}
                      <span className="ml-2 font-mono">{item.key}</span>
                    </Label>
                    <Input
                      spellCheck={false}
                      placeholder="AxisX"
                      value={glossary[item.text] ?? ""}
                      onChange={(event) => setGlossary((current) => ({ ...current, [item.text]: event.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">文案译文</span>
            <Badge variant={lang.needsTranslation ? "secondary" : "outline"}>待译 {lang.pendingTranslations.length}</Badge>
            {lang.glossaryRequired.length > 0 && (
              <Badge variant="destructive">必须补术语表 {lang.glossaryRequired.length}</Badge>
            )}
          </div>
          {lang.needsTranslation && (
            <>
              <div>
                <Button variant="outline" size="sm" disabled={busy !== ""} onClick={() => void suggestTextsOnly()}>
                  {busy === "ai-lang" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  让 AI 重新出候选译文
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {lang.pendingTranslations.map((item) => (
                  <div key={item.key + item.sourceRef} className="flex flex-col gap-1">
                    <Label className="text-muted-foreground text-xs">
                      {item.text}
                      <span className="ml-2 font-mono">{item.key}</span>
                    </Label>
                    <Input
                      spellCheck={false}
                      placeholder="English"
                      value={texts[item.text] ?? ""}
                      onChange={(event) => setTexts((current) => ({ ...current, [item.text]: event.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy === "submit"} onClick={() => void submit(true)}>
          {busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          确认并继续
        </Button>
        <Button variant="outline" disabled={busy !== ""} onClick={() => void load()}>
          <RefreshCw className="size-4" />
          重新读取
        </Button>
        <Button variant="ghost" disabled={busy === "submit"} onClick={() => void submit(false)}>
          只写入，不继续
        </Button>
      </div>
    </div>
  )

}
