/*
 * 区域前缀的**预览**（不是决定）：和插件 run-all.ps1 取值链的第 4/5 级同一套规则——
 *   `F3Align` → `F3`（Target 编号前缀）；`HomeContent` → `Home`（Target 首词）。
 * 真值源仍在插件：界面只把「会推出什么」显示给人看，空着的时候仍然让插件自己解析，
 * 不把预览值当参数发过去（猜错会把产物写进别的区域目录）。
 */

export function deriveUiPrefix(target: string): string {
  const text = String(target || "").trim()
  if (!text) return ""
  const numbered = /^([A-Za-z]+\d+)/.exec(text)
  if (numbered) return numbered[1]
  const word = /^([A-Z]+(?![a-z])|[A-Z][a-z0-9]*)/.exec(text)
  return word ? word[1] : ""
}
