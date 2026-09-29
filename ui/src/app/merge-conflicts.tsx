import { GitMerge } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ClampText } from "@/app/clamp-text"
import type { BoardMergeConflict } from "@/lib/api"

/*
 * 冲突逐文件裁决：一单冲突里每个文件各选一份（以本任务为准 / 保留主工程），选完再点「重新合并」。
 * 选择只存在后端（task.resolutions）—— 界面不自己再记一份，否则两边会各说各的。
 * resolvable=false 的文件取哪一份都错（产物本身不合格），不给按钮，只能回去修。
 */
export function MergeConflicts({
  conflicts,
  resolutions,
  busy,
  onPick
}: {
  conflicts: BoardMergeConflict[]
  resolutions: Record<string, "mine" | "main">
  busy: boolean
  onPick: (path: string, pick: "mine" | "main" | "clear") => Promise<void>
}) {
  const choosable = conflicts.filter((conflict) => conflict.resolvable)
  const chosen = choosable.filter((conflict) => resolutions[conflict.path]).length
  const pick = (path: string) => resolutions[path]

  async function bulkMine() {
    for (const conflict of choosable) {
      if (pick(conflict.path) === "mine") continue
      await onPick(conflict.path, "mine")
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-destructive text-xs">
        冲突 {conflicts.length} 处 · 已裁决 {chosen}/{choosable.length}
        ：整单一个字节都不写，选完点「重新合并」
      </span>
      {choosable.length > 1 && (
        <Button size="sm" variant="outline" className="h-7 w-fit" disabled={busy} onClick={() => void bulkMine()}>
          <GitMerge className="size-3.5" />
          全部以本任务为准
        </Button>
      )}
      {conflicts.map((conflict) => (
        <div key={conflict.path} className="flex flex-col gap-1 rounded-md border px-2 py-1.5">
          <span className="font-mono text-xs break-all">{conflict.path}</span>
          <ClampText text={conflict.reason} lines={2} className="text-muted-foreground text-xs" />
          {conflict.resolvable ? (
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant={pick(conflict.path) === "mine" ? "default" : "outline"}
                className="h-7"
                disabled={busy}
                onClick={() => void onPick(conflict.path, "mine")}
              >
                以本任务为准
              </Button>
              <Button
                size="sm"
                variant={pick(conflict.path) === "main" ? "default" : "outline"}
                className="h-7"
                disabled={busy}
                onClick={() => void onPick(conflict.path, "main")}
              >
                保留主工程
              </Button>
              {pick(conflict.path) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  disabled={busy}
                  onClick={() => void onPick(conflict.path, "clear")}
                >
                  撤销选择
                </Button>
              )}
            </div>
          ) : (
            <span className="text-destructive text-xs">这一处不能由人拍板（理由见上），先修好再重新合并。</span>
          )}
        </div>
      ))}
    </div>
  )
}
