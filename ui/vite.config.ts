import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const here = path.dirname(fileURLToPath(import.meta.url))
// 默认端口只有一处（仓库根的 lib/config.js）：开发时的代理目标跟着它走。
const { DEFAULT_HOST, DEFAULT_PORT } = createRequire(import.meta.url)(path.resolve(here, "..", "lib", "config.js"))

// 开发时前端跑在 5173，/api 代理到 server.js（默认地址见 lib/config.js）。
// 生产构建直接输出到仓库根的 public/，由 server.js 提供，不再需要 Vite。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(here, "src") },
  },
  build: {
    outDir: path.resolve(here, "..", "public"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.API_TARGET ?? `http://${DEFAULT_HOST}:${DEFAULT_PORT}`,
        changeOrigin: false,
      },
    },
  },
})
