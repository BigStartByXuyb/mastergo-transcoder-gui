import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, type Artifacts } from "@/lib/api"

/*
 * 「已完成」看板：列出这次运行真正落到工程里的文件。
 * 清单以插件的运行登记表（Generated/runs/<Target>/run.json 的 outputs）为准，
 * 界面不自己扫目录 —— 哪些是产物、哪些是中间件由插件定义。
 */
export function DoneBoard({ projectRoot, target }: { projectRoot: string; target: string }) {
  const [artifacts, setArtifacts] = useState<Artifacts | null>(null)

  useEffect(() => {
    if (!projectRoot.trim() || !target.trim()) return
    api
      .artifacts(projectRoot, target)
      .then((payload) => setArtifacts(payload.artifacts))
      .catch(() => setArtifacts(null))
  }, [projectRoot, target])

  if (!artifacts?.available) return null

  return (
    <Card className="border-emerald-600/40">
      <CardHeader>
        <CardTitle>已完成</CardTitle>
        <CardDescription>
          这次运行落到工程里的文件（以插件的运行登记表为准）。运行标识 {artifacts.runId}
          {artifacts.mode ? " · " + artifacts.mode : ""}
        </CardDescription>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Badge variant="secondary">产物 {artifacts.project.length}</Badge>
          <Badge variant="outline">审计件 {artifacts.audit.length}</Badge>
          {artifacts.backupCount > 0 && <Badge variant="outline">备份 {artifacts.backupCount}</Badge>}
          {artifacts.cleanedCount > 0 && <Badge variant="outline">已清理中间件 {artifacts.cleanedCount}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="overflow-hidden rounded-md border">
          {/* 列宽按比例给：产物路径再长也只换行，不把整张表撑出容器。 */}
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[72%]">产物</TableHead>
                <TableHead className="w-[28%]">SHA256</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {artifacts.project.map((item) => (
                <TableRow key={item.file}>
                  <TableCell className="font-mono text-xs break-all whitespace-normal">{item.file}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs whitespace-normal">
                    {item.sha256 ? item.sha256.slice(0, 12) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {artifacts.project.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-muted-foreground py-6 text-center text-sm">
                    登记表里没有产物
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {artifacts.summary && artifacts.summary.todos.length > 0 && (
          <div>
            <div className="text-muted-foreground text-xs">本页待办（不是失败，是后续要跟进的）</div>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {artifacts.summary.todos.map((todo, index) => (
                <li key={String(todo.kind ?? index)}>
                  {todo.kind} {todo.count ?? ""}
                  {todo.byReason ? " · " + JSON.stringify(todo.byReason) : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
