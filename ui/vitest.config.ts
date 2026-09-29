import { fileURLToPath } from "node:url"
import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const here = path.dirname(fileURLToPath(import.meta.url))

/*
 * 前端单测与覆盖率口径。
 *
 * 覆盖率只统计“有单元测试意义的表面”：src/lib/**（纯逻辑）、src/app 里的两个 hook
 * （useIdentity / useRunLog，取数与轮询都在这里）与三个共用的展示组件。
 * 页面级组件（pipeline/board/query/settings…）是编排与渲染，已经薄到只剩拼装，不进分母。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(here, "src") }
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: [path.resolve(here, "src/test-setup.ts")],
    // 单进程跑：本机并行起多个 jsdom 环境会把内存打爆（实测 heap OOM），用例量也还不需要并行。
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reportsDirectory: path.resolve(here, "coverage"),
      include: [
        "src/lib/**/*.ts",
        "src/app/use-*.ts",
        "src/app/task-steps.tsx",
        "src/app/ai-fill-line.tsx",
        "src/app/effective-toggle.tsx"
      ],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/lib/api.ts"],
      reporter: ["text"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 75,
        statements: 90
      }
    }
  }
})
