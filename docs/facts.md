# 判据台账（唯一权威）

一件事的判据只能在**一处**。下表左边是那件事，中间是它的真值源（文件 · 文件里那段唯一的字符串），
右边是读它的人。

`tests/consistency.test.js` 的「判据台账与代码对得上」按这张表机械核对：**那段字符串在 `lib/` 与
`ui/src/` 下只准出现在这一处**（用例是夹具，不算）—— 少一处（真值源里没有）或多一处（别处又写了一遍）
都当场失败。所以「同一件事有几处」不用靠人肉 grep。

新增一条判据 = 在这里加一行；判据换住处 = 改「真值源」这一格。

| 这件事 | 真值源（文件 · 那段唯一的字符串） | 谁在读它 |
| --- | --- | --- |
| 插件契约里「哪一步吃哪个输入文件」 | `lib/plugin.js` · `const INPUT_FILES = {` | `lib/board.js`（标人/AI 输入、给界面 `layoutStep`）、`lib/confirm.js`（写回之后的续跑锚点） |
| 任务与运行状态的中文名 | `lib/board.js` · `function stateLabelOf(` | 看板任务行（`publicTask`）、动作失败原话、`lib/pending-queue.js`（随条目给出 `stateLabel`） |
| 停点 / 失败那一行的措辞 | `ui/src/app/failure-note.tsx` · `export function failureTitle(` | 说明卡（同文件的 `FailureNote`）、看板任务行 |
| 「运行中不给续跑」的判据与说法 | `ui/src/lib/task-state.ts` · `export function isInFlight(`、`export function inFlightNote(` | 布局确认面板、待确认面板 |
| 收图的四条判据（空 / 读不出 / 太大 / 不是 PNG·JPEG） | `lib/design-image.js` · `function requireBitmap(` | 暂存（`stage`）与存图（`save`） |
| 先选的位图落地结果 | `lib/design-image.js` · `function installStaged(` | `lib/board.js`（写到任务行的 `designImage`） |
| 待确认清单的取数（含三张草稿与叫 AI 出候选） | `ui/src/app/use-pending-inputs.ts` · `api.pending(` | 待确认面板（取数只有这一处）；面板自己只管渲染与提交编排 |
| 面板动作的骨架（置忙 → 清旧错 → 跑 → 收尾） | `ui/src/app/use-action-runner.ts` · `export function useValueRunner(` | `useActionRunner`（同文件）、`use-task-actions.ts`、`use-layout-groups.ts`、`use-plugin-sources.ts`、`use-plugin-update.ts`、`board-page.tsx`、`design-image-card.tsx`、设置页（`update-card` / `codex-card` / `runtime-panel` / `source-dialog` / `settings-agent-panel`） |
| 界面唯一的网络出口 | `ui/src/lib/api.ts` · `fetch(` | 所有界面件（别的文件不直接发请求） |
| 先选的位图暂存在哪（键是什么） | `lib/design-image.js` · `function stagedPathOf(` | 暂存（`lib/routes.js` 的 `POST /api/design-image/stage`）、落地与清理（`lib/board.js`）；界面只把任务 id 交给暂存接口，不自己拼键（`ui/src/app/stage-design-images.ts`） |
| 位图尺寸不符时那两个数怎么写 | `lib/design-image.js` · `function sizeMismatchText(` | 存图被拒的原话（同文件的 `save`）、看板任务行上那句提示（`lib/board.js`） |
| 「要当文件名的一段名字」的收口（空 / 非法分开说） | `lib/name-safety.js` · `function requireSafeName(` | 页面 Target 与任务 id 两个包装（同文件）；工程目录那一处不走它（那是路径，不是名字） |
| 「这一份与清单对不上的是哪几个文件」 | `lib/update.js` · `function mismatchedFiles(` | 切换前的校验（同文件的 `apply`）、安装根那一份的核验（`installRootIsVersion`） |
| 「本地这一份」（安装根那一棵树）算不算它声称的那一版 | `lib/update.js` · `function installRootIsVersion(` | `stagedReachable`（设置页与探活都读它）；结论缓存（含「核不出来」那种），作废只有两处、跟着触发点走：写指针（`writePointer`，切换与回退共用）与写下一版的清单（`writeVersionManifest`，检查与下载共用）；读盘出错不抛、按「认它」处理 |
| 顶栏那条入口该对哪一版动作 | `lib/update.js` · `function targetVersionOf(` | `readState`（五态与它同出一处）、`hint()` 的 `target`（顶栏只渲染，不自己比一遍）；被外壳下限挡住的那一版不参与 |
| 这一条还能不能「从断点继续」、从哪一步续 | `lib/board.js` · `function resumeOf(` | 看板快照的 `task.resume`（`publicTask`）与续跑计划（`planResume`）；界面那条按钮读它，不拿失败原话里的步骤名猜 |
| 某一版能不能用在这一台上（外壳下限） | `lib/update.js` · `function usableHere(` | 「这一份可以切过去」（`switchable`：选版与版本表逐行都读它，清单都按 `manifestOf` 取）；与 `apply` 前那一刻的 `versionBlocked` 同源 |
| 「自动补输入并续跑」谁发起 | `ui/src/app/pending-panel.tsx` · `automation === "auto" && !taskId` | 看板任务由服务端发起（`lib/board.js` 的 `autoFillWaiting` → `lib/autofill.js`，同一个 automation 设置，不需要浏览器在场）；面板只对没有看板任务的条目发起 |
| 位图落地要等的那一步怎么说 | `lib/design-image.js` · `const NO_CANVAS_REASON =` | 界面那一块照后端给的原话显示（`/api/design-image` 的 `blocked`）；表单的指引不提步骤名，只说「流水线产出画板尺寸之后」 |

