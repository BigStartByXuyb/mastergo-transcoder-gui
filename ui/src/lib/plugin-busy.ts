/*
 * 插件页「哪个动作在跑」的 key 只有这一处：忙碌位是一个字符串，写（hook）与读（组件）都从这里取，改名不会漏。
 *   load    读来源清单（插件在哪、哪一版）
 *   check   检查客户端自带那一份有没有新版
 *   install 下载并装上新版
 * 三个动作分属两个 hook，各报各的：卡片只把它们摆出来判定「这一页闲不闲」。
 */
export const PLUGIN_BUSY = {
  load: "load",
  check: "check",
  install: "install"
} as const
