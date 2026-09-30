import { useEffect, useMemo, useState } from "react"
import { Copy, Loader2, Search } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ClampText } from "@/app/clamp-text"
import { PixelLoader } from "@/app/pixel-loader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiFailure, api, type ResolveResult, type ResolvedNode } from "@/lib/api"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "mastergo-transcoder-gui.query"

const FRAME_SOURCES: Record<string, string> = {
  "page-registry": "工程登记表",
  manifest: "工程快照",
  snapshot: "本地快照",
  "frame-link": "你指定的页面帧链接",
  link: "你贴的链接"
}

function nodeLabel(node: ResolvedNode | null): string {
  return node?.name ? node.name : "(未命名)"
}

function posOf(node: ResolvedNode): string {
  const x = typeof node.pageAbsX === "number" ? Math.round(node.pageAbsX) : null
  const y = typeof node.pageAbsY === "number" ? Math.round(node.pageAbsY) : null
  const w = typeof node.width === "number" ? Math.round(node.width) : null
  const h = typeof node.height === "number" ? Math.round(node.height) : null
  if (x === null || y === null) return ""
  return x + "," + y + (w !== null && h !== null ? " · " + w + "×" + h : "")
}

async function copyText(value: string, label: string) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const area = document.createElement("textarea")
    area.value = value
    document.body.appendChild(area)
    area.select()
    document.execCommand("copy")
    document.body.removeChild(area)
  }
  toast.success("已复制" + (label ? "：" + label : ""))
}

type Failure = { message: string; hint: string }

export function QueryPage() {
  const [link, setLink] = useState("")
  const [frameLink, setFrameLink] = useState("")
  const [projectDir, setProjectDir] = useState("")
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [result, setResult] = useState<ResolveResult | null>(null)
  const [selectedRef, setSelectedRef] = useState("")
  const [filter, setFilter] = useState("")
  const [onlyMapped, setOnlyMapped] = useState(true)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")
      if (saved.link) setLink(String(saved.link))
      if (saved.frameLink) setFrameLink(String(saved.frameLink))
      if (saved.projectDir) setProjectDir(String(saved.projectDir))
    } catch {
      /* 存储不可用就忽略 */
    }
  }, [])

  function persist(next: { link?: string; frameLink?: string; projectDir?: string }) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ link, frameLink, projectDir, ...next })
      )
    } catch {
      /* 忽略 */
    }
  }

  async function submit() {
    const trimmed = link.trim()
    if (!trimmed) {
      setFailure({ message: "请先粘贴 MasterGo 链接", hint: "在 MasterGo 里选中容器（页面帧）或控件，用「复制链接」，然后粘到上面的输入框。" })
      return
    }
    persist({ link: trimmed })
    setFailure(null)
    setLoading(true)
    try {
      const payload = await api.resolve({ link: trimmed, frameLink: frameLink.trim(), projectDir: projectDir.trim() })
      setResult(payload)
      setFilter("")
      setOnlyMapped(true)
      setSelectedRef(payload.mode === "single" && payload.target ? payload.target.ref : "")
    } catch (error) {
      const message = error instanceof ApiFailure ? error.message : String(error instanceof Error ? error.message : error)
      const hint = error instanceof ApiFailure ? error.hint : ""
      setFailure({ message, hint })
    } finally {
      setLoading(false)
    }
  }

  const nodes = result?.nodes ?? []

  const visibleNodes = useMemo(() => {
    const keyword = filter.trim().toLowerCase()
    return nodes.filter((node) => {
      // 有搜索词时按全量节点找（设计新增的控件可能还没登记映射）；没搜索词才应用「只看控件」。
      if (!keyword) return onlyMapped ? Boolean(node.xml) : true
      return [node.name, node.text, node.layerId, node.id, node.ref, node.controlType]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    })
  }, [nodes, filter, onlyMapped])

  const selected = nodes.find((node) => node.ref === selectedRef) ?? null

  return (
    <div className="flex w-full flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>MasterGo 链接</CardTitle>
          <CardDescription>
            在 MasterGo 里选中页面帧（容器）或控件 → 复制链接 → 粘到这里。只给 ID，不做整页转码。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="query-link">MasterGo 链接</Label>
            <div className="flex gap-2">
              <Input
                id="query-link"
                spellCheck={false}
                placeholder="https://mastergo.com/goto/xxxx?page_id=4:4&layer_id=79:162125&file=181586559903927"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit()
                }}
              />
              <Button type="button" disabled={loading} onClick={() => void submit()}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                {loading ? "查询中…" : "查询"}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="query-frame">页面帧链接（可选）</Label>
              <Input
                id="query-frame"
                spellCheck={false}
                placeholder="整页那个容器的链接；填了就与整页转码完全一致"
                value={frameLink}
                onChange={(event) => setFrameLink(event.target.value)}
                onBlur={() => persist({ frameLink })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="query-project">工程目录（可选）</Label>
              <Input
                id="query-project"
                spellCheck={false}
                placeholder="工程目录的绝对路径 —— 从它的快照与登记表自动找页面帧（离线）"
                value={projectDir}
                onChange={(event) => setProjectDir(event.target.value)}
                onBlur={() => persist({ projectDir })}
              />
            </div>
          </div>

          {loading && (
            <Alert>
              <AlertTitle>正在取设计稿…</AlertTitle>
              <AlertDescription>首次查询一个页面大约 10–30 秒（之后同一页面走缓存，几毫秒）。</AlertDescription>
            </Alert>
          )}
          {failure && (
            <Alert variant="destructive">
              <AlertTitle>
                <ClampText text={failure.message} className="break-words" />
              </AlertTitle>
              {failure.hint && (
                <AlertDescription>
                  <ClampText text={failure.hint} />
                </AlertDescription>
              )}
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 查询要跑插件那几步，等的时候让小狐狸顶着，别只把按钮改成「查询中…」。 */}
      {loading && !result && (
        <Card>
          <CardContent className="pt-6">
            <PixelLoader text="请稍等，正在查询控件" className="py-6" />
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>
              {result.mode === "single" ? "控件：" + nodeLabel(result.target) : "容器内控件（" + result.capture.totalCount + "）"}
            </CardTitle>
            <CardDescription>
              {result.mode === "single"
                ? "已按页面帧 " + result.frame.layerId + " 定位到该控件；下表同时列出同一容器里的其他控件。"
                : "这些 ID 与整页转码一致（页面键 = " + result.capture.pageKey + "）。点一行看它该用的 ID 与控件代码。"}
            </CardDescription>
            <div className="flex flex-wrap gap-2 pt-2">
              <Badge variant={result.frame.verified ? "secondary" : "outline"}>
                页面帧 {result.frame.layerId} · {FRAME_SOURCES[result.frame.from] ?? result.frame.from}
                {result.frame.verified ? "" : "（未核对工程）"}
              </Badge>
              <Badge variant="outline">页面键 {result.capture.pageKey}</Badge>
              <Badge variant="secondary">节点 {result.capture.totalCount}</Badge>
              <Badge variant="secondary">映射命中 {result.capture.mappedCount}</Badge>
              <Badge variant="outline">{result.capture.source === "mastergo" ? "设计稿实时" : "本地快照"}</Badge>
              <Badge variant="outline">{(result.elapsedMs / 1000).toFixed(1)}s</Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {result.notes.map((note) => (
              <Alert key={note}>
                <AlertDescription>{note}</AlertDescription>
              </Alert>
            ))}

            <div className="flex flex-wrap items-center gap-3">
              <Input
                className="max-w-xs"
                placeholder="按名称 / 文本 / layer_id 过滤"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <div className="flex items-center gap-2">
                <Switch id="only-mapped" checked={onlyMapped} onCheckedChange={setOnlyMapped} />
                <Label htmlFor="only-mapped">只看命中映射的控件</Label>
              </div>
              <span className="text-muted-foreground text-sm">
                {visibleNodes.length} / {nodes.length}
              </span>
            </div>

            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>控件</TableHead>
                    <TableHead>位置</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>映射</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleNodes.map((node) => (
                    <TableRow
                      key={node.ref}
                      data-state={node.ref === selectedRef ? "selected" : undefined}
                      className={cn("cursor-pointer", node.ref === selectedRef && "bg-muted")}
                      onClick={() => setSelectedRef(node.ref)}
                    >
                      <TableCell>
                        <div className="font-medium">{nodeLabel(node)}</div>
                        {node.text && <div className="text-muted-foreground text-xs">{node.text}</div>}
                        <div className="text-muted-foreground text-xs">
                          {node.layerId} · {node.type}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{posOf(node)}</TableCell>
                      <TableCell>
                        <code className="text-xs">{node.id}</code>
                      </TableCell>
                      <TableCell>
                        {node.controlType ? (
                          <Badge variant="secondary">{node.controlType}</Badge>
                        ) : (
                          <Badge variant="outline">未登记</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {visibleNodes.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground py-8 text-center">
                        没有符合条件的控件
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle>
              {nodeLabel(selected)}
              {selected.text ? "（" + selected.text + "）" : ""}
            </CardTitle>
            <CardDescription>
              layer_id {selected.layerId} · {selected.type}
            </CardDescription>
            <div className="pt-2">
              {selected.controlType ? (
                <Badge variant="secondary">
                  {selected.controlType}
                  {selected.template && selected.template.includes(" / ")
                    ? " · " + selected.template.split(" / ")[1]
                    : ""}
                </Badge>
              ) : (
                <Badge variant="outline">未登记映射</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <code className="bg-muted rounded px-3 py-2 text-sm">{selected.id}</code>
              <Button variant="outline" size="sm" onClick={() => void copyText(selected.id, nodeLabel(selected))}>
                <Copy className="size-4" />
                复制 ID
              </Button>
              {selected.xml && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText(selected.xml ?? "", nodeLabel(selected) + " 的控件代码")}
                >
                  <Copy className="size-4" />
                  复制控件代码
                </Button>
              )}
            </div>

            <dl className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["控件", nodeLabel(selected)],
                  ["文本", selected.text || "—"],
                  ["layer_id", selected.layerId],
                  ["位置", posOf(selected) || "—"],
                  ["节点 ref", selected.ref],
                  ["页面键", result?.capture.pageKey ?? ""]
                ] as const
              ).map(([term, value]) => (
                <div key={term}>
                  <dt className="text-muted-foreground text-xs">{term}</dt>
                  <dd className="text-sm break-all">{value}</dd>
                </div>
              ))}
            </dl>

            {selected.xml ? (
              <pre className="bg-muted max-h-96 overflow-auto rounded-md p-3 text-xs">{selected.xml}</pre>
            ) : (
              <Alert>
                <AlertTitle>这个控件不在正式映射表里</AlertTitle>
                <AlertDescription>需要人工按设计稿手写，或先补映射登记。</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
