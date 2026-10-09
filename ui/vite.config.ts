import { fileURLToPath } from "node:url"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import type { ProxyOptions } from "vite"

const here = path.dirname(fileURLToPath(import.meta.url))

// 开发时前端由 Vite 起（端口用它的默认值，看它打印的地址），/api 代理到后端。
// 后端地址由起服务那一侧给（仓库根的 npm run dev:ui 会把地址设进下面那个环境变量），ui 这个包不读后端源码。
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
 * /api 代理到哪一份后端：环境变量给，值只有一处定义（仓库根的 lib/config.js）。
 * 没给就不代理（只影响开发时的 /api，构建与测试都不需要它），并说清怎么拿到这个值。
 */
function apiProxy(): Record<string, ProxyOptions> {
  const target = process.env["API_TARGET"]
  if (!target) {
    console.warn("[vite] 没有 API_TARGET：/api 不代理。从仓库根跑 npm run dev:ui（它按 lib/config.js 的地址设好）。")
    return {}
  }
  return {
    "/api": { target, changeOrigin: false },
  }
}
