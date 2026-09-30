import { useState } from "react"
import { Terminal } from "lucide-react"

import { Button } from "@/components/ui/button"

/*
 * 一轮的引擎日志（stderr）。正常跑完的那一堆噪音默认收着；
 * 收尾不干净时由调用方传 open=true 铺开，人也能手动点开。
 */
export function EngineLog({ text, open }: { text: string; open: boolean }) {
  const [shown, setShown] = useState(open)
  const body = text.replace(/\n+$/, "")
  if (!body) return null
  const lines = body.split("\n").length
  return (
    <div className="flex flex-col gap-2 pl-8">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => setShown((current) => !current)}>
        <Terminal className="size-3" />
        引擎日志（{lines} 行）
      </Button>
      {shown && (
        <pre className="bg-muted text-muted-foreground max-h-60 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
          {body}
        </pre>
      )}
    </div>
  )
}
