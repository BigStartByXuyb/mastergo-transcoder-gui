import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCw, Send, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiFailure, api, type Pending } from "@/lib/api"

const BASIS_LABEL: Record<string, string> = {
  "host-shell": "宿主外壳自带",
  "icon-policy-none": "映射表登记为不登记",
  "icon-policy-runtime": "运行时决定",
  "bottom-bar-resident": "底部栏常驻"
}

function describe(error: unknown): string {
  if (error instanceof ApiFailure) return error.message + (error.hint ? "：" + error.hint : "")
  return String(error instanceof Error ? error.message : error)
}

export function ReviewPage() {
  const [projectRoot, setProjectRoot] = useState("")
  const [target, setTarget] = useState("")
  const [runId, setRunId] = useState("")
  const [pending, setPending] = useState<Pending | null>(null)
  const [names, setNames] = useState<Record<number, { name: string; comment: string }>>({})
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState("")
  const [failure, setFailure] = useState("")
  const [allowEmptyLedger, setAllowEmptyLedger] = useState(true)
  const autoLoaded = useRef(false)

  const load = useCallback(async (root: string, page: string) => {
    if (!root.trim() || !page.trim()) {
      setFailure("先填工程目录和页面 Target")
      return
    }
    setBusy("load")
    setFailure("")
    try {
      const payload = await api.pending(root.trim(), page.trim())
      setPending(payload.pending)
      setNames((current) => {
        const next = { ...current }
        for (const item of payload.pending.icons.mustName) {
          if (!next[item.index]) next[item.index] = { name: "", comment: "" }
        }
        for (const row of payload.pending.icons.naming) {
          next[row.index] = { name: row.name ?? "", comment: row.comment ?? "" }
        }
        return next
      })
      setTexts((current) => {
        const next = { ...current }
        for (const item of payload.pending.translations.pendingTranslations) {
          if (next[item.text] === undefined) next[item.text] = payload.pending.translations.translations[item.text] ?? ""
        }
        return next
      })
    } catch (error) {
      setFailure(describe(error))
    } finally {
      setBusy("")
    }
  }, [])

  // 从最近一次运行继承工程目录与页面名，省得重敲；参数齐了就顺手读一次清单。
  useEffect(() => {
    api
      .runStatus()
      .then((payload) => {
        const job = payload.job
        if (!job) return
        setRunId(job.id)
        if (job.request.projectRoot) setProjectRoot(job.request.projectRoot)
        if (job.request.target) setTarget(job.request.target)
        if (job.request.projectRoot && job.request.target && !autoLoaded.current) {
          autoLoaded.current = true
          void load(job.request.projectRoot, job.request.target)
        }
      })
      .catch(() => undefined)
  }, [load])

  async function suggestNames() {
    if (!pending) return
    setBusy("ai-icons")
    setFailure("")
    try {
      const payload = await api.aiIconNames(pending.icons.mustName)
      setNames((current) => {
        const next = { ...current }
        for (const item of payload.items) next[item.index] = { name: item.name, comment: item.comment }
        return next
      })
      toast.success("已填入 " + payload.items.length + " 条建议")
    } catch (error) {
      setFailure(describe(error))
    } finally {
      setBusy("")
    }
  }

  async function suggestTexts() {
    if (!pending) return
    setBusy("ai-lang")
    setFailure("")
    try {
      const payload = await api.aiTranslations(pending.translations.pendingTranslations.map((item) => item.text))
      setTexts((current) => {
        const next = { ...current }
        for (const item of payload.items) next[item.text] = item.translation
        return next
      })
      toast.success("已填入 " + payload.items.length + " 条译文")
    } catch (error) {
      setFailure(describe(error))
    } finally {
      setBusy("")
    }
  }

  async function submit(resume: boolean) {
    if (!pending) return
    setBusy("submit")
    setFailure("")
    try {
      const naming = pending.icons.mustName.map((item) => ({
        index: item.index,
        name: names[item.index]?.name ?? "",
        comment: names[item.index]?.comment ?? ""
      }))
      const translations: Record<string, string> = {}
      for (const item of pending.translations.pendingTranslations) {
        const value = texts[item.text]
        if (value && value.trim()) translations[item.text] = value.trim()
      }
      const payload = await api.confirm({
        projectRoot: pending.projectRoot,
        target: pending.target,
        runId,
        naming: pending.icons.available && pending.icons.needsNaming ? naming : undefined,
        translations: pending.translations.available ? translations : undefined,
        allowEmptyLedger: pending.icons.available && !pending.icons.needsNaming ? allowEmptyLedger : false,
        resume
      })
      const summary = payload.written.map((item) => item.path.split(/[\\/]/).pop() + "（" + item.count + " 条）").join("、")
      toast.success("已写入：" + summary + (payload.job ? "，已从断点继续" : ""))
      if (payload.note) setFailure(payload.note)
      await load(pending.projectRoot, pending.target)
    } catch (error) {
      setFailure(describe(error))
    } finally {
      setBusy("")
    }
  }

  const icons = pending?.icons
  const lang = pending?.translations

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>待确认</CardTitle>
          <CardDescription>
            流水线停在语义判断点时，这里列出它要人/AI 补的输入。写回后从断点继续。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="review-project">工程目录</Label>
              <Input
                id="review-project"
                spellCheck={false}
                value={projectRoot}
                onChange={(event) => setProjectRoot(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="review-target">页面 Target</Label>
              <Input
                id="review-target"
                spellCheck={false}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              />
            </div>
          </div>
          <div>
            <Button variant="outline" disabled={busy === "load"} onClick={() => void load(projectRoot, target)}>
              {busy === "load" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              读取待确认清单
            </Button>
          </div>
          {failure && (
            <Alert variant="destructive">
              <AlertTitle>出错了</AlertTitle>
              <AlertDescription className="break-all">{failure}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {icons?.available && (
        <Card>
          <CardHeader>
            <CardTitle>图标命名</CardTitle>
            <CardDescription>
              「要不要登记」由插件机械判定；这里只补「叫什么名字」。
            </CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {icons.registrationSummary && <Badge variant="secondary">需登记 {icons.registrationSummary.register}</Badge>}
              {icons.registrationSummary && <Badge variant="outline">不登记 {icons.registrationSummary.skip}</Badge>}
              {icons.registrationSummary && icons.registrationSummary.review > 0 && (
                <Badge variant="destructive">待复核 {icons.registrationSummary.review}</Badge>
              )}
              {icons.registrationSummary &&
                Object.entries(icons.registrationSummary.byBasis).map(([basis, count]) => (
                  <Badge key={basis} variant="outline">
                    {BASIS_LABEL[basis] ?? basis} {count}
                  </Badge>
                ))}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!icons.needsNaming && (
              <>
                <Alert>
                  <AlertTitle>本页没有要登记的图标</AlertTitle>
                  <AlertDescription>
                    候选 {icons.candidates.length} 条全部由插件判定为无需登记。这种情况插件要求显式声明空台账，
                    而不是写一份空的命名表——下面勾上它，第 7 步才会用空台账继续。
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
                  <Button variant="outline" disabled={busy === "ai-icons"} onClick={() => void suggestNames()}>
                    {busy === "ai-icons" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    AI 出候选名
                  </Button>
                </div>
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>图标 / 归属</TableHead>
                        <TableHead className="w-56">资源名</TableHead>
                        <TableHead className="w-56">中文注释</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {icons.mustName.map((item) => (
                        <TableRow key={item.index}>
                          <TableCell className="text-muted-foreground text-xs">{item.index}</TableCell>
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
          </CardContent>
        </Card>
      )}

      {lang?.available && (
        <Card>
          <CardHeader>
            <CardTitle>文案译文</CardTitle>
            <CardDescription>
              中文 → 英文。译文是显式输入，流水线只机械套用、不翻译。
            </CardDescription>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Badge variant={lang.needsTranslation ? "secondary" : "outline"}>
                待译 {lang.pendingTranslations.length}
              </Badge>
              {lang.glossaryRequired.length > 0 && (
                <Badge variant="destructive">必须补术语表 {lang.glossaryRequired.length}</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!lang.needsTranslation && <p className="text-muted-foreground text-sm">没有待补译文。</p>}
            {lang.needsTranslation && (
              <>
                <div>
                  <Button variant="outline" disabled={busy === "ai-lang"} onClick={() => void suggestTexts()}>
                    {busy === "ai-lang" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    AI 出候选译文
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
          </CardContent>
        </Card>
      )}

      {pending && (icons?.available || lang?.available) && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy === "submit"} onClick={() => void submit(true)}>
            {busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            提交并从断点继续
          </Button>
          <Button variant="outline" disabled={busy === "submit"} onClick={() => void submit(false)}>
            只写入，不继续
          </Button>
        </div>
      )}
    </div>
  )
}
