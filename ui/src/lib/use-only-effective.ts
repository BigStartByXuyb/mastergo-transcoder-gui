import { useState } from "react"

import { readOnlyEffective, writeOnlyEffective } from "@/lib/only-effective"

/*
 * 「只看生效」这个开关：读一次、写一次都走这里。
 *
 * 看板页与区域页共用同一份记忆，两页各写一段一样的 setState + 落盘没有意义 ——
 * 存储层只有 writeOnlyEffective 一个入口，接线也收成这一个 hook。
 */
export function useOnlyEffective(): { onlyEffective: boolean; setOnlyEffective: (value: boolean) => void } {
  const [onlyEffective, setOnlyEffective] = useState(readOnlyEffective)

  function change(value: boolean) {
    setOnlyEffective(value)
    writeOnlyEffective(value)
  }

  return { onlyEffective: onlyEffective, setOnlyEffective: change }
}
