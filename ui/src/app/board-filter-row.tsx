import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { BoardTask } from "@/lib/api"
import {
  EMPTY_BOARD_FILTERS,
  STATE_FILTERS,
  UI_NONE,
  filterChoices,
  hasFilters,
  type BoardFilters
} from "@/lib/board-filters"

/*
 * 看板的筛选行：工作区 / UI / 状态。
 *
 * 选项只从当前任务里取（没有任务的工作区不占位）；条件已经给了就显示「清除」。
 * 工作区下拉里显示最后两段路径，完整路径挂在下面那一行 —— 窄下拉里放不下整条。
 */
export function BoardFilterRow(props: {
  tasks: BoardTask[]
  filters: BoardFilters
  /** 筛完剩下几条 / 一共几条：筛选生效时这一行要能看出少在哪。 */
  shown: number
  onChange: (filters: BoardFilters) => void
}) {
  const choices = filterChoices(props.tasks)
  const active = hasFilters(props.filters)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={props.filters.projectRoot || "all"}
        onValueChange={(value) => props.onChange({ ...props.filters, projectRoot: value === "all" ? "" : value })}
      >
        <SelectTrigger size="sm" className="w-44" aria-label="按工作区筛选">
          <SelectValue placeholder="全部工作区" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部工作区</SelectItem>
          {choices.projects.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <span className="font-mono text-xs" title={item.value}>
                {item.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={props.filters.ui === "" ? "all" : props.filters.ui === UI_NONE ? "none" : props.filters.ui}
        onValueChange={(value) => props.onChange({ ...props.filters, ui: value === "all" ? "" : value === "none" ? UI_NONE : value })}
      >
        <SelectTrigger size="sm" className="w-32" aria-label="按区域筛选">
          <SelectValue placeholder="全部区域" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部区域</SelectItem>
          {choices.uis.map((item) => (
            <SelectItem key={item.value || "none"} value={item.value || "none"}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={props.filters.state || "all"}
        onValueChange={(value) => props.onChange({ ...props.filters, state: value === "all" ? "" : value })}
      >
        <SelectTrigger size="sm" className="w-32" aria-label="按状态筛选">
          <SelectValue placeholder="全部状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          {STATE_FILTERS.map((item) => (
            <SelectItem key={item.key} value={item.key}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="text-muted-foreground text-xs">
        {active ? "筛出 " + props.shown + " / 共 " + props.tasks.length + " 条" : "共 " + props.tasks.length + " 条"}
      </span>

      {active && (
        <Button size="sm" variant="ghost" onClick={() => props.onChange(EMPTY_BOARD_FILTERS)}>
          <X className="size-3.5" />
          清除筛选
        </Button>
      )}
    </div>
  )
}
