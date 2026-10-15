import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ProjectPages } from "@/lib/api"

/*
 * 工程登记表里已登记的页面：按 UI 区域分组，点一下填上 Target（条目里写了 Ui 就连 Ui 一起填）。
 */

/** 选了登记表里的一页要回填的东西：Target 与 UI 区域，缺哪个就填哪个。 */
export type TargetPick = { target?: string; ui?: string }

export function ProjectPagesPicker(props: {
  pages: ProjectPages | null
  target: string
  ui: string
  onPick: (patch: TargetPick) => void
}) {
  const pages = props.pages
  if (!pages) return null
  if (!pages.exists) return <span>{pages.problem}</span>
  if (pages.pages.length === 0) return <span>登记表里还没有可用的页面条目。</span>

  const groups = [...new Set(pages.pages.map((page) => page.ui || "（未写 Ui）"))].sort()
  return (
    <div className="flex flex-col gap-1">
      <span>
        登记表里登记的页面（按 UI 分组；点一下填上 Target，条目里写了 Ui 就连 Ui 一起填）
        {props.ui.trim() ? "　当前：UI " + props.ui.trim() : ""}
        {props.target.trim() ? " · " + props.target.trim() : ""}
      </span>
      {groups.map((group) => (
        <div key={group} className="flex flex-wrap items-center gap-2">
          <Badge variant={props.ui.trim() === group ? "default" : "outline"}>{group}</Badge>
          {pages.pages
            .filter((page) => (page.ui || "（未写 Ui）") === group)
            .map((page, index) => (
              <Button
                key={page.target + index}
                type="button"
                size="sm"
                variant="outline"
                // 条目里没写 Ui 时照实留空：区域由插件按 Target 前缀自己推。
                onClick={() => props.onPick(page.target ? { target: page.target, ui: page.ui } : { ui: page.ui })}
              >
                {page.target || page.layerId}
              </Button>
            ))}
        </div>
      ))}
    </div>
  )
}
