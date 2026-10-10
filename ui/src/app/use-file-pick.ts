import { useRef } from "react"

/*
 * 选文件框的共用行为：把选中的那一份交出去，然后把 input 的 value 清掉 ——
 * 不清的话「再选同一份文件」不会再触发 change（同一个 File 对象本身不受影响，读它照旧）。
 * 谁用：设计稿位图的共用选图框（ui/src/app/design-image-picker.tsx）与任务详情里那一张图（design-image-card.tsx）。
 */
export function useFilePick(onPick: (file: File | null) => void) {
  const input = useRef<HTMLInputElement>(null)
  return {
    /** 挂在 <input ref> 上：卡片那种「按钮点它」的形态也要拿它。 */
    input: input,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      onPick(event.target.files?.[0] ?? null)
      if (input.current) input.current.value = ""
    }
  }
}
