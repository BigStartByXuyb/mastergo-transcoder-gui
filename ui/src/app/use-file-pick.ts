import { useRef } from "react"

/*
 * 选图框只按大类筛一下：能不能收由后端按**文件头**判（lib/design-image.js 的 requireBitmap），
 * 所以别用后缀清单把改名过的文件挡在外面。两个入口（新建任务的选图框、任务详情那张图）共用这一份。
 */
export const IMAGE_ACCEPT = "image/*"

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
