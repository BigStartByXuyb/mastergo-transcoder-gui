import type { RefObject } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/*
 * 运行日志卡片：run-all.ps1 的实时输出；每一步的完整日志另存在工作目录的 Generated\_work\steps\。
 */

type Props = {
  logText: string
  logRef: RefObject<HTMLPreElement | null>
}

export function TaskLogCard({ logText, logRef }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>运行日志</CardTitle>
        <CardDescription>
          来自 run-all.ps1 的实时输出；每步的完整日志另存在工作目录的 Generated\_work\steps\ 下。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre ref={logRef} className="bg-muted max-h-96 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
          {logText || "（暂无输出）"}
        </pre>
      </CardContent>
    </Card>
  )
}
