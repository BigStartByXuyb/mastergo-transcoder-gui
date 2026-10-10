# 项目结构（唯一权威）

这一份说三件事：**目录各管什么**、**谁可以读谁**、**一个请求/一次操作从哪个入口走到哪**。
别的文档与注释不复述这三件事，只指向本文（索引见 [`README.md`](README.md)）。

## 目录

| 位置 | 管什么 | 不许放什么 |
| --- | --- | --- |
| `server.js` | 服务入口：装配（设置、插件、运行时、代理、日志）并起 HTTP 服务 | 具体业务实现 |
| `launch.js` + `lib/launch.js` | 启动壳与监督进程：按指针选版本、起子进程、换版本重启 | 服务里才有的模块 |
| `lib/` | 服务端能力：一个模块一件事，文件头那句注释就是它的职责 | 界面代码；跨层的界面调用 |
| `shared/` | 前后端共用的纯工具（版本比较这类两端都要用的），业务判据不放这里 | 业务判据；界面代码 |
| `ui/` | 界面包（独立 npm 包，只经 HTTP 与后端打交道）：`src/app` 页面与视图件、`src/lib` 前端逻辑 | 后端源码；后端常量 |
| `public/` | 界面构建产物（`npm run build:ui` 生成，入库） | 手写的源文件 |
| `scripts/` + `scripts/lib/` | 工具链：打包、发布、winget、起前端等一次性任务 | 运行期会加载的逻辑 |
| `tools/launcher/` | 不依赖 Node 的启动器（Go） | 任何 JavaScript |
| `tests/` | 一条链路/一个模块一份用例；命名 `<主题>.test.js`；用例共用的小夹具（`image-fixtures.js`） | 生产代码 |
| `docs/` | 说明：一份文档一类事，索引见 [`README.md`](README.md) | 与实现重复的清单 |
| `vendor/` | 模型依赖的压缩件（由 `scripts/vendor-openai.js` 生成） | 手写源码 |
| 运行目录（`versions/`、`agents/`、`plugins/`、`runtime/`、`blobs/`、`logs/`、`work/`、`chats/`、`update-cache/`、`dist/`、`output/`、`.playwright-cli/`） | 本机状态与产物（`.gitignore` 里那些） | 仓库源码 |

根条目清单（与上表合起来，就是允许出现在仓库顶层的全部条目）：
`node_modules/`、[`README.md`](../README.md)、[`AGENTS.md`](../AGENTS.md)、`package.json`、`package-lock.json`、`changelog.json`、`start.cmd`、
`mastergo-transcoder.exe`、`runtime-assets.json`、`local.json`、`credentials`、`mastergo-credentials`、
按发布源派生的 `*-credentials`、`board.json`、`chats.json`、`current.json` 与 `ui/` 自己的配置文件。
新加顶层条目要同一次写进这两处之一。

## 依赖方向

```
server.js ──> lib/ ──> shared/ ──> (node 标准库、第三方包)
   │            ↑
   │            └── scripts/（工具链可以读 lib/）
   │
ui/  ──HTTP──> server.js          ui/ 只读 shared/（公共库），不读 lib/ 或脚本
tools/launcher（Go）  独立，不读 JavaScript
tests/ ──> lib/、scripts/、ui/src（用例可以读任一侧）
launch.js ──> lib/launch.js      壳只用自己拥有的两份文件
```

上面这些方向的守门人列在 [`gates.md`](gates.md)。

## 一次操作怎么走

| 场景 | 路径 |
| --- | --- |
| 起客户端 | `start.cmd` → `launch.js`（读 `current.json` 选版本）→ `server.js` → 浏览器打开默认地址（见 `lib/config.js`） |
| 界面取数 | `ui/src/lib/api.ts` → `/api/*` → `lib/routes.js` → 对应能力模块 |
| 跑流水线 | 看板/流水线页 → `/api/run/*` → `lib/run.js` → 插件 `run-all.ps1`（`lib/plugin.js` 定位，`lib/runtime.js` 给 node/pwsh） |
| 查控件 ID | 控件查询页 → `/api/query/*` → `lib/node-controls.js` → 插件取数脚本 |
| 更新客户端 | 设置 → 更新 → `lib/update.js`（`lib/recheck.js` 定时、`lib/manifest-fetch.js` 取清单、`lib/app-manifest.js` 校验） |
| 更新插件 | 设置 → 更新 → 插件（流水线）→ `lib/plugin-update.js`（件协议见 [`release-and-update.md`](release-and-update.md)） |
| 换版本 | 界面 → `/api/update/*` → 写 `current.json` → `launch.js` 起新的一份 |

## 功能结构

按子系统分，每个子系统一个或几个 `lib/` 模块 + 对应的界面页 + 至少一份用例：

| 子系统 | 服务端 | 界面 | 用例 |
| --- | --- | --- | --- |
| 看板与任务 | `board.js`、`concurrency.js`、`idle.js` | `board-page.tsx`、`board-task-table.tsx`、`done-board.tsx`、`new-task-card.tsx`、`board-new-task-dialog.tsx`、`board-filter-row.tsx`、`area-page.tsx`、`task-detail-card.tsx`、`effective-toggle.tsx`、`use-areas.ts`、`use-board-tasks.ts` | `board.test.js`、`board-flow.test.js`、`use-board-tasks.test.tsx` |
| 流水线 | `run.js`、`page-progress.js`、`run-mark.js` | `pipeline-page.tsx`、`task-steps.tsx`、`step-card.tsx`、`failure-note.tsx`、`task-log-card.tsx`、`ai-fill-line.tsx`、`use-run-log.ts`、`use-task-actions.ts`、`ui/src/lib/step-rows.ts` | `run.test.js`、`run-failure.test.js`、`resume-after-restart.test.js`、`task-steps.test.tsx`、`step-rows.test.ts`、`use-task-actions.test.tsx` |
| 待确认与语义补全 | `pending.js`、`pending-queue.js`、`confirm.js`、`identity.js`、`autofill.js`、`ai.js`、`layout-groups.js` | `pending-panel.tsx`、`identity-fill-panel.tsx`、`review-page.tsx`、`layout-panel.tsx`、`use-identity.ts`、`use-identity-fill.ts`、`use-layout-groups.ts`、`use-pending.ts`、`ui/src/lib/layout-edit.ts` | `identity.test.js`、`confirm-source.test.js`、`layout-groups.test.js`、`pending-layout.test.js`、`pending-queue.test.js`、`autofill-layout.test.js`、`use-pending.test.tsx` |
| 对话 | `chat.js`、`codex.js`、`codex-release.js`、`agent-context.js` | `chat-page.tsx`、`chat-transcript.tsx`、`codex-card.tsx`、`agent-avatar.tsx`、`chat-engine-log.tsx`、`chat-new-dialog.tsx`、`template-dialog.tsx` | `chat.test.js`、`codex.test.js`、`agent-context.test.js` |
| 控件查询与映射 | `node-controls.js`、`mapping.js`、`resolve-target.js`、`resolve.js`、`project-pages.js`、`design-page-name.js`、`design-image.js`、`artifacts.js`、`xml-chunk.js`、`icon-names.js` | `query-page.tsx`、`mapping-page.tsx`、`design-image-card.tsx`、`project-pages-picker.tsx` | `node-controls.test.js`、`mapping.test.js`、`resolve-target.test.js`、`project-pages.test.js`、`design-image.test.js` |
| 插件 | `plugin.js`、`plugin-root.js`、`plugin-update.js`、`plugin-layout.js` | `plugin-card.tsx`、`plugin-source-table.tsx`、`plugin-install-block.tsx`、`plugin-order-bar.tsx`、`plugin-source-dialog.tsx`、`plugin-source-facts.tsx`、`use-plugin-sources.ts`、`use-plugin-update.ts` | `plugin-sources.test.js`、`plugin-update.test.js`、`plugin-layout.test.js` |
| 运行时 | `runtime.js`、`runtime-policy.js`、`exe-path.js`、`pwsh.js`、`download.js`、`bundle-store.js`、`tar.js`、`atomic-write.js` | `settings-runtime-panel.tsx`、`runtime-panel.tsx`、`runtime-source-dialog.tsx` | `runtime.test.js`、`bundle-store.test.js`、`download.test.js`、`tar.test.js` |
| 更新与发布 | `update.js`、`update-task.js`、`recheck.js`、`manifest-fetch.js`、`app-manifest.js`、`changelog.js` | `update-card.tsx`、`update-badge.tsx`、`settings-update-panel.tsx`、`update-source-row.tsx`、`update-source-actions.tsx`、`confirm-switch-dialog.tsx`、`download-actions.ts`、`use-status-poll.ts`、`use-failure-memory.ts` | `update.test.js`、`app-manifest.test.js`、`changelog.test.js` |
| 设置与凭据 | `settings.js`、`config.js`、`source.js`、`mcp-token.js`、`proxy.js`、`getter.js` | `settings-page.tsx`、`settings-ai-panel.tsx`、`settings-mastergo-panel.tsx`、`settings-agent-panel.tsx`、`source-dialog.tsx`、`tab-button.tsx` | `settings-templates.test.js`、`mastergo-token.test.js`、`source.test.js`、`proxy.test.js` |
| 上传与合并 | `uploads.js`、`merge.js`、`limits.js` | `chat-write-dialog.tsx`、`merge-conflicts.tsx` | `uploads.test.js`、`merge.test.js` |
| 壳与自愈 | `launch.js`、`bootstrap.js`、`log.js` | —（控制台） | `launch.test.js`、`bootstrap.test.js`、`log.test.js` |
| 通用件 | `errors.js`、`http.js`、`versions.js`、`workdir.js`、`name-safety.js`、`system-open.js`、`pick-folder.js`、`routes.js`、`ansi.js` | `ui/src/lib/*.ts`、`ui/src/app/pager.tsx`、`clamp-text.tsx`、`copy-text.ts`、`pixel-loader.tsx`、`app-shell.tsx`、`busy-action-button.tsx`、`busy-overlay.tsx`、`identifier-text.tsx`、`pixel-mascot.tsx`、`use-action-runner.ts`、`use-alive.ts` | `edges.test.js`、`system-open.test.js`、`pick-folder.test.js` |

## 约束与门禁

- **约束**写在 [`../AGENTS.md`](../AGENTS.md)：改代码时按它做。
- **门禁**（哪条用例守哪条规矩、读哪处真值源）写在 [`gates.md`](gates.md)。
- 新增门禁的登记规矩见 `gates.md`（那里是门禁的唯一权威）。
