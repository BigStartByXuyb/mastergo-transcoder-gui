import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { pageCount } from "@/lib/paging"

/*
 * 分页条：一屏放得下就别往下拖。
 * 页数与页码夹取交给 lib/paging.ts，这里只管把结论摆出来并把点击传上去。
 */
export function Pager(props: { page: number; total: number; size: number; onPage: (page: number) => void }) {
  const pages = pageCount(props.total, props.size)
  const current = Math.min(Math.max(1, props.page), pages)
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">
        第 {current} / {pages} 页 · 共 {props.total} 条
      </span>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={current <= 1}
          onClick={() => props.onPage(current - 1)}
          title="上一页"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={current >= pages}
          onClick={() => props.onPage(current + 1)}
          title="下一页"
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
