import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import type { ProxyOptions } from "vite"

const here = path.dirname(fileURLToPath(import.meta.url))
// 后端地址与「换地址」那个变量名只有一处（仓库根的 lib/config.js）。这里读它是开发工具链的配置
// （不进包、不改分层），应用代码仍然只经 HTTP 与后端打交道。
const { DEFAULT_HOST, DEFAULT_PORT, API_TARGET_ENV, baseUrl } =
  createRequire(import.meta.url)(path.resolve(here, "..", "lib", "config.js"))

// 开发时前端跑在 5173，/api 代理到后端（默认地址见 lib/config.js）。
// 生产构建直接输出到仓库根的 public/，由 server.js 提供，不再需要 Vite。
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(here, "src") },
  },
  build: {
    outDir: path.resolve(here, "..", "public"),
    emptyOutDir: true,
  },
  // 只有开发服务器要代理；构建产物由 server.js 提供，不需要它。
  server: command === "serve" ? { proxy: apiProxy() } : undefined,
}))

/*
 * /api 代理到哪一份后端：默认就是 lib/config.js 的地址；后端起在别处时用那个环境变量覆盖。
 */
function apiProxy(): Record<string, ProxyOptions> {
  const target = process.env[API_TARGET_ENV] || baseUrl(DEFAULT_HOST, DEFAULT_PORT)
  return {
    "/api": { target, changeOrigin: false },
  }
}
