import { useRemembered } from "@/app/use-remembered"
import { readOnlyEffective, writeOnlyEffective } from "@/lib/only-effective"

/*
 * 「只看生效」这个开关：读一次、写一次都走 use-remembered 那一份（本地记忆怎么记只有那一处）。
 * 看板页与区域页共用同一份记忆，两页各写一段一样的 setState + 落盘没有意义。
 */
export function useOnlyEffective(): { onlyEffective: boolean; setOnlyEffective: (value: boolean) => void } {
  const [onlyEffective, setOnlyEffective] = useRemembered(readOnlyEffective, writeOnlyEffective)
  return { onlyEffective, setOnlyEffective }
}
