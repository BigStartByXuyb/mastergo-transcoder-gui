import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { LayoutControl } from "@/lib/api"
import { labelOf, numberOf } from "@/lib/layout-edit"
import { cn } from "@/lib/utils"

/*
 * 布局确认里的画布：把这一页的设计稿位图与控件框（带编号）摆在一起 ——
 * 人对编号说话，编号得能指到画板上的哪一块，「缺分组表」那一步才讲得清。
 *
 * 编号的规则只有一处（ui/src/lib/layout-edit.ts 的 numberOf）：图上的号与旁边清单里的号同源。
 * 图不在了（没传过 / 被删了 / 加载失败）就退成只看编号 —— 画布的用处本来就是「号画在哪」。
 */

export function LayoutCanvas(props: {
  controls: LayoutControl[]
  canvas: { width: number; height: number }
  /** 设计稿位图的地址；空串＝没有图，只看编号。 */
  imageUrl: string
  /** 现在要高亮哪几个控件（鼠标停在某个组上时，传那一组的成员）。 */
  highlight: string[]
}) {
  /*
   * 设计稿可以盖掉：图不在了（onError）就自己收起来，别挂一张破图。
   * 这个开关只管这一块，不往面板外传 —— 面板要的是「号」，图只是参照。
   */
  const [showDesign, setShowDesign] = useState(true)
  const percent = (value: number, total: number) => (value / total) * 100 + "%"
  const canvas = props.canvas

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium">画布</span>
        <span className="text-muted-foreground text-xs">
          框里的号就是下面清单里的号；鼠标停到某个组上，它的成员会在图上描出来。
        </span>
        {props.imageUrl && (
          <Button size="sm" variant="outline" onClick={() => setShowDesign(!showDesign)}>
            {showDesign ? "隐藏设计稿" : "显示设计稿"}
          </Button>
        )}
      </div>
      <div
        className="relative w-full overflow-hidden rounded-md border bg-muted/30"
        style={{ aspectRatio: canvas.width + " / " + canvas.height }}
      >
        {showDesign && props.imageUrl && (
          <img
            src={props.imageUrl}
            alt="这一页的设计稿位图"
            className="absolute inset-0 size-full object-fill"
            onError={() => setShowDesign(false)}
          />
        )}
        {props.controls.map((control) => {
          const on = props.highlight.includes(control.ref)
          return (
          <span
            key={control.ref}
            data-ref={control.ref}
            /* 被描出来没有：语义钩子（用例按它断言，不绑样式类名）。 */
            data-highlighted={on}
            title={labelOf(props.controls, control.ref)}
            className={cn("absolute border", on ? "border-primary bg-primary/20" : "border-primary/50")}
            style={{
              left: percent(control.absX, canvas.width),
              top: percent(control.absY, canvas.height),
              width: percent(control.w, canvas.width),
              height: percent(control.h, canvas.height)
            }}
          >
            <span className="bg-background/90 absolute -top-1.5 -left-1 rounded px-0.5 text-[0.6rem] leading-tight tabular-nums">
              {numberOf(props.controls, control.ref)}
            </span>
          </span>
          )
        })}
      </div>
    </div>
  )
}
