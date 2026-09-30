import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { PixelHand, PixelMascot } from "@/app/pixel-mascot"
import { cn } from "@/lib/utils"

/*
 * 加载时的样子：小狐狸站在文字上方，它的手指从左边一个字一个字指到右边，
 * 指到哪个字哪个字往下跳一下；指到头就把手收起来，随机停 0–3 秒，再来一遍。
 *
 * 文案统一是「请稍等，正在XXXX」；动作只做一件事（指），不做别的花样。
 * 系统设了「减少动态效果」时不指，只静态显示，避免晕。
 */

const STEP_MS = 260
const REST_MAX_MS = 3000

/* 中文按字切（一个一个字跳），英文与版本号整块保留（`v0.4.2` 不该拆开）。 */
function slotsOf(text: string): string[] {
  const out: string[] = []
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue
    if (/[\u4e00-\u9fa5]/.test(token)) {
      for (const char of token) out.push(char)
      continue
    }
    out.push(token)
  }
  return out
}

function reducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function PixelLoader(props: { text: string; cell?: number; className?: string }) {
  const slots = slotsOf(props.text)
  const [active, setActive] = useState(reducedMotion() ? -1 : 0)
  const [handX, setHandX] = useState<number | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const slotRefs = useRef<(HTMLSpanElement | null)[]>([])

  // 走位：当前这个字 → 下一个字 → …… → 收手 → 等 0–3 秒 → 回到第一个字。
  useEffect(() => {
    if (reducedMotion() || slots.length === 0) return
    const delay = active < 0 ? 200 + Math.random() * REST_MAX_MS : STEP_MS
    const timer = window.setTimeout(() => {
      setActive((current) => (current >= slots.length - 1 ? -1 : current + 1))
    }, delay)
    return () => window.clearTimeout(timer)
  }, [active, slots.length])

  // 手的位置取当前那个字的中心：字宽不一样，按实际位置摆才不会越指越偏。
  useLayoutEffect(() => {
    const row = rowRef.current
    const slot = active >= 0 ? slotRefs.current[active] : null
    if (!row || !slot) {
      setHandX(null)
      return
    }
    setHandX(slot.offsetLeft + slot.offsetWidth / 2)
  }, [active, props.text])

  return (
    <div className={cn("flex flex-col items-center gap-2", props.className)}>
      <span className="pixel-bob">
        <PixelMascot cell={props.cell ?? 4} />
      </span>
      <div ref={rowRef} className="relative flex flex-wrap items-center justify-center gap-[3px]">
        {/* 手在字的上方一点点，看上去就是从狐狸那边伸下来的。 */}
        {handX !== null && (
          <span
            className="pointer-events-none absolute -top-3.5 transition-[left] duration-200 ease-out"
            style={{ left: handX, transform: "translateX(-50%)" }}
          >
            <PixelHand cell={props.cell ?? 4} />
          </span>
        )}
        {slots.map((slot, index) => (
          <span
            key={index + slot}
            ref={(node) => {
              slotRefs.current[index] = node
            }}
            className={cn(
              "text-muted-foreground inline-block text-xs transition-transform duration-150",
              index === active && "text-foreground translate-y-[2px]"
            )}
          >
            {slot}
          </span>
        ))}
      </div>
    </div>
  )
}
