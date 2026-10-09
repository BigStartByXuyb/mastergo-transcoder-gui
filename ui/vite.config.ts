import { fileURLToPath } from "node:url"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

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
  // 只有开发服务器要代理；构建产物由 server.js 提供，不需要它，也就不要求后端地址。
  server: command === "serve" ? devServer() : undefined,
}))

function devServer() {
  const target = process.env.API_TARGET
  if (!target) {
    throw new Error("没有 API_TARGET：从仓库根跑 npm run dev:ui（它会按 lib/config.js 的地址设好）。")
  }
  return {
    proxy: {
      "/api": { target, changeOrigin: false },
    },
  }
}
