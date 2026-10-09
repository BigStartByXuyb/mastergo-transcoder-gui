import { fileURLToPath } from "node:url"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import type { ProxyOptions } from "vite"

const here = path.dirname(fileURLToPath(import.meta.url))

// 开发时前端跑在 5173，/api 代理到后端；后端地址由起服务那一侧给（仓库根的 npm run dev:ui
// 按 lib/config.js 设好 API_TARGET），前端不读后端源码。
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
  // 只有开发服务器要代理；构建产物由 server.js 提供，不需要它，也就不问后端地址。
  server: command === "serve" ? { proxy: apiProxy() } : undefined,
}))

/*
 * /api 代理到哪一份后端：由起服务那一侧给（仓库根的 npm run dev:ui 按 lib/config.js 设好 API_TARGET）。
 * 没给就不代理（只影响开发时的 /api，构建与测试都不需要它），并说清怎么拿到这个值。
 */
function apiProxy(): Record<string, ProxyOptions> {
  const target = process.env.API_TARGET
  if (!target) {
    console.warn("[vite] 没有 API_TARGET：/api 不代理。从仓库根跑 npm run dev:ui（它会按 lib/config.js 的地址设好）。")
    return {}
  }
  return {
    "/api": { target, changeOrigin: false },
  }
}
