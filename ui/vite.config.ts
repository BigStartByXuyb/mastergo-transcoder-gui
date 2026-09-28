import { fileURLToPath } from "node:url"
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const here = path.dirname(fileURLToPath(import.meta.url))

// 开发时前端跑在 5173，/api 代理到 server.js（默认 8787）。
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
        target: process.env.API_TARGET ?? "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
})
