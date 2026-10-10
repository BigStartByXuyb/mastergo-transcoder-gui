import { useCallback, useEffect, useRef, useState } from "react"
import { CheckCircle2, Loader2, RefreshCw, Send, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ClampText } from "@/app/clamp-text"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PENDING_BUSY, usePendingInputs } from "@/app/use-pending-inputs"
import { api } from "@/lib/api"
import { describeFailure } from "@/lib/describe-failure"
import { inFlightNote, isInFlight, pendingInputCount, waitingCounts } from "@/lib/task-state"

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

// 写进去的文件 → 人看得懂的名字。用于「AI 补了什么」在流程里的显示。
const WRITTEN_LABEL: Record<string, string> = {
  "icon-naming.json": "图标命名",
  "lang-translations.json": "译文",
  "lang-glossary.json": "术语",
  // 分组表由布局确认面板写回（同一份 /api/confirm），写进去的文件名这里也认。
  "layout-groups.json": "布局分组"
}

function labelOfWritten(item: { path: string; count: number }) {
  const file = item.path.split(/[\\/]/).pop() ?? ""
  const hit = Object.keys(WRITTEN_LABEL).find((name) => file.endsWith(name))
  return (hit ? WRITTEN_LABEL[hit] : file) + " " + item.count + " 条"
}

/** 刚补进去的东西，交给调用方显示在流程里：补了什么、从哪一步续跑。 */
export type PendingFilled = { filled: string[]; resumedFrom: string }

/* 提交这条动作自己的忙位名（面板自己那一半；取数/叫模型那一半在 use-pending-inputs 的 PENDING_BUSY）。 */
const SUBMIT_BUSY = "submit"

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
  taskId,
  runId,
  state,
  automation,
  onResumed
}: {
  projectRoot: string
  target: string
  /** 看板任务 id：续跑按它落回那一行，拿 jobId 当钥匙会在运行被换掉后失效。 */
  taskId: string
  /** 来源运行 id：非看板来源（流水线直跑、任务已移除）没有 taskId，续跑只有它能用。 */
  runId: string
  /**
   * 来源运行/任务的状态。两件事都靠它：
   *   - 跑着的时候不给续跑（判据见 ui/src/lib/task-state.ts 的 isInFlight）；
   *   - 状态一变就重读清单 —— 同一次运行「跑着 → 停下」后会新出现待办，不重读就看不见。
   * 重读的判据收在面板里（下面 load 的依赖），两个入口都不必记得另传什么指纹。
   */
  state: string
  automation: string
  onResumed?: (info: PendingFilled) => void
}) {
  /*
   * 清单、三张草稿与叫 AI 都在 use-pending-inputs 那一处（取数只在那里取一次）；
   * 面板这里只留「提交并续跑」这条动作的忙位与失败 —— 两处合起来是界面要显示的那一份。
   */
  const inputs = usePendingInputs({ projectRoot, target, taskId, runId, state })
  const { pending, names, texts, glossary, setName, setText, setGlossaryOf, aiReady, clearFailure } = inputs
  const {
    namingPayload,
    translationsPayload,
    glossaryPayload,
    fillIconNames,
    fillTranslations,
    fillGlossary
  } = inputs
  const [submitBusy, setSubmitBusy] = useState("")
  const [submitFailure, setSubmitFailure] = useState("")
  const [allowEmptyLedger, setAllowEmptyLedger] = useState(true)
  const autoKey = useRef("")
  const busy = inputs.busy || submitBusy
  const failure = inputs.failure || submitFailure
  const load = inputs.reload

  const iconTotal = pending?.icons.available ? pending.icons.mustName.length : 0
  const iconCount = pending?.icons.available ? pending.icons.missing : 0
  // 命名表里插件当前不认的旧下标（上一版设计稿留下的）：也要处理，否则第 7 步会拒绝。
  const staleCount = pending?.icons.available ? pending.icons.stale : 0
  // 资源名撞在一起的组数（同名图层按图层名起名就会撞）：第 7 步的台账要求同一页里名字唯一。
  const duplicateGroups = pending?.icons.available ? pending.icons.duplicates : []
  const duplicateCount = duplicateGroups.length
  const langCount = pending?.translations.available ? pending.translations.pendingTranslations.length : 0
  const glossaryCount = pending?.translations.available ? pending.translations.glossaryRequired.length : 0
  // 本页还缺多少条语义输入：布局确认在 layout-panel 单独处理，这里只数图标 + 文案（同一个判据给看板那张卡用）。
  const waiting = pendingInputCount(waitingCounts(pending))

  /*
   * 「本页没有图标槽位」只有一种情形：插件判定必须登记的候选一条都没有。
   * 已经填完命名表**不算** —— 那时再传 -AllowEmptyLedger，后端会按空台账处理，
   * 直接清掉刚写好的命名表，产物会退化成没有图标的一页。
   */
  const noIconSlots = Boolean(pending?.icons.available) && (pending?.icons.mustName.length ?? 0) === 0
  // 有待办才让提交；没有图标槽位时靠「按空台账继续」这一个显式声明兜底。
  const canSubmit = Boolean(pending) && (waiting > 0 || (noIconSlots && allowEmptyLedger))
  /*
   * 跑着的时候不给续跑：这条判据与布局确认面板同一处（ui/src/lib/task-state.ts 的 isInFlight）。
   * 待确认清单不按运行状态过滤，正在跑的任务照样会列在这里 —— 两个入口的口径必须一样。
   */
  const inFlight = isInFlight(state)

  // 显式接收入参：自动路径拿的是「刚取回的候选」，等 setState 生效再读会拿到空值。
  const submitWith = useCallback(
    async (
      resume: boolean,
      naming: { index: number; name: string; comment: string; fromDsl?: boolean }[],
      translations: Record<string, string>,
      glossaryMap: Record<string, string>
    ) => {
      if (!pending) return
      // 先清掉这条数据线上的旧失败：两处失败合成一句显示，旧的不清会盖住这一次提交的失败。
      clearFailure()
      setSubmitBusy(SUBMIT_BUSY)
      setSubmitFailure("")
      try {
        const payload = await api.confirm({
          projectRoot: pending.projectRoot,
          target: pending.target,
          taskId,
          runId,
          naming: pending.icons.available && pending.icons.needsNaming ? naming : undefined,
          translations: pending.translations.available ? translations : undefined,
          glossary: pending.translations.available ? glossaryMap : undefined,
          allowEmptyLedger: noIconSlots && allowEmptyLedger,
          // 命名表写歪了（旧下标 / 重名）就顺手修好：这次提交不只是补名字。
          pruneNaming: Boolean(pending.icons.available && pending.icons.needsRepair),
          resume
        })
        const written = payload.written.map(labelOfWritten)
        const summary = written.join("、")
        toast.success("已写入：" + (summary || "无") + (payload.job ? "，已从断点继续" : ""))
        await load()
        if (payload.job) onResumed?.({ filled: written, resumedFrom: payload.resumedFrom ?? "" })
      } catch (error) {
        setSubmitFailure(describeFailure(error))
      } finally {
        setSubmitBusy("")
      }
    },
    [pending, taskId, runId, allowEmptyLedger, load, onResumed, clearFailure]
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
    // 跑着的时候连自动那条路也不续跑：那会与人工点「确认并继续」一样起第二次运行。
    if (inFlight) return
    if (waiting === 0) return
    if (aiReady !== true) return
    const key =
      projectRoot + "|" + target + "|" + iconCount + "|" + staleCount + "|" + duplicateCount + "|" + langCount + "|" + glossaryCount
    if (autoKey.current === key) return
    autoKey.current = key
    void (async () => {
      // 叫模型那段（忙碌位与失败原话）由 use-pending-inputs 管；失败回 null 就不再往下续跑。
      let naming = namingPayload()
      let translations = translationsPayload()
      let glossaryMap = glossaryPayload()
      if (iconCount > 0) {
        const filled = await fillIconNames()
        if (!filled) return
        naming = filled.value
        toast.success("AI 出了 " + filled.count + " 条图标名")
      }
      if (langCount > 0) {
        const filled = await fillTranslations()
        if (!filled) return
        translations = filled.value
        toast.success("AI 出了 " + filled.count + " 条译文")
      }
      if (glossaryCount > 0) {
        const filled = await fillGlossary()
        if (!filled) return
        glossaryMap = filled.value
        toast.success("AI 出了 " + filled.count + " 条术语")
      }
      /*
       * 自动层级：出完候选直接提交并续跑，人只需要在日志里回看。
       * 但看板任务那条不在这里续跑 —— 同一个停点只该有一个发起者：看板任务由服务端负责
       *（lib/board.js 的 autoFillWaiting → lib/autofill.js，它读同一个 automation 设置，
       * 而且不需要浏览器在场）；这里只对没有看板任务的条目（流水线直跑 / 孤儿）发起，免得同一个停点起两次运行。
       */
      if (automation === "auto" && !taskId) await submitWith(true, naming, translations, glossaryMap)
    })()
  }, [
    pending,
    automation,
    inFlight,
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
    fillIconNames,
    fillTranslations,
    fillGlossary,
    submitWith
  ])

  async function suggestNamesOnly() {
    const filled = await fillIconNames()
    if (filled) toast.success("已填入 " + filled.count + " 条")
  }

  async function suggestTextsOnly() {
    const filled = await fillTranslations()
    if (filled) toast.success("已填入 " + filled.count + " 条")
  }

  if (!pending) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        {busy === PENDING_BUSY.load && <Loader2 className="size-4 animate-spin" />}
        <ClampText text={failure || "读取待确认清单…"} />
      </div>
    )
  }

  const icons = pending.icons
  const lang = pending.translations

  return (
    <div className="flex flex-col gap-4">
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>
            <ClampText text={failure} />
          </AlertDescription>
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
            {staleCount > 0 && <Badge variant="destructive">旧条目 {staleCount}</Badge>}
            {duplicateCount > 0 && <Badge variant="destructive">重名 {duplicateCount} 组</Badge>}
            {icons.registrationSummary &&
              Object.entries(icons.registrationSummary.byBasis).map(([basis, count]) => (
                <Badge key={basis} variant="outline">
                  {BASIS_LABEL[basis] ?? basis} {count}
                </Badge>
              ))}
          </div>

          {staleCount > 0 && (
            <Alert className="border-amber-500/60">
              <AlertTitle>命名表里有 {staleCount} 条这一页用不到的旧条目</AlertTitle>
              <AlertDescription>
                下标 {pending?.icons.staleIndexes.join("、")} 是上一次用同一个 Target 时留下的（多半换了设计稿或图层）。
                插件把它们算作多余图标，第 7 步会直接拒绝。提交时会把它们清掉。
              </AlertDescription>
            </Alert>
          )}

          {duplicateCount > 0 && (
            <Alert className="border-amber-500/60">
              <AlertTitle>{duplicateCount} 组图标的资源名撞在一起</AlertTitle>
              <AlertDescription>
                {duplicateGroups.map((group) => group.name + "（下标 " + group.indexes.join("、") + "）").join("；")}。
                图层名相同的实例不算同一个图标，同一页里资源名必须唯一，第 7 步的台账会直接拒绝。
                提交时会把重复的按下标顺序补数字（插在 Geometry 后缀之前）；想按自己的口径区分，就改上面的资源名。
              </AlertDescription>
            </Alert>
          )}

          {noIconSlots && (
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

          {(icons.needsNaming || duplicateCount > 0) && (
            <>
              <div>
                <Button variant="outline" size="sm" disabled={busy !== ""} onClick={() => void suggestNamesOnly()}>
                  {busy === PENDING_BUSY.icons ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
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
                            onChange={(event) => setName(item.index, { name: event.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={names[item.index]?.comment ?? ""}
                            onChange={(event) => setName(item.index, { comment: event.target.value })}
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
                      onChange={(event) => setGlossaryOf(item.text, event.target.value)}
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
                  {busy === PENDING_BUSY.translations ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
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
                      onChange={(event) => setText(item.text, event.target.value)}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy === SUBMIT_BUSY || !canSubmit || inFlight} onClick={() => void submit(true)}>
          {busy === SUBMIT_BUSY ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          确认并继续
        </Button>
        <Button variant="outline" disabled={busy !== ""} onClick={() => void load()}>
          <RefreshCw className="size-4" />
          重新读取
        </Button>
        <Button variant="ghost" disabled={busy === SUBMIT_BUSY || !canSubmit || inFlight} onClick={() => void submit(false)}>
          只写入，不继续
        </Button>
        {inFlight && canSubmit && <span className="text-muted-foreground text-xs">{inFlightNote("确认并继续")}</span>}
        {!canSubmit && pending && (
          <span className="text-muted-foreground text-xs">这个页面当前没有要填的东西。</span>
        )}
      </div>
    </div>
  )

}
