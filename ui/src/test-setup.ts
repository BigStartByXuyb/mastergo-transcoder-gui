import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

/*
 * 每个用例结束后卸载渲染树。
 * 少了这一步，组件里的 setInterval / 定时器会活过用例边界，在 jsdom 拆掉之后触发，
 * 变成“门禁全绿但带着一条未处理错误”的假绿（也污染同一进程里的其它用例文件）。
 */
afterEach(() => {
  cleanup()
})
