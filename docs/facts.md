# 判据台账（唯一权威）

一件事的判据只能在**一处**。下表左边是那件事，中间是它的真值源（文件 · 文件里那段唯一的字符串），
右边是读它的人。

`tests/consistency.test.js` 的「判据台账与代码对得上」按这张表机械核对：**那段字符串在 `lib/` 与
`ui/src/` 下只准出现在这一处**（用例是夹具，不算）—— 少一处（真值源里没有）或多一处（别处又写了一遍）
都当场失败。所以「同一件事有几处」不用靠人肉 grep。

新增一条判据 = 在这里加一行；判据换住处 = 改「真值源」这一格。

| 这件事 | 真值源（文件 · 那段唯一的字符串） | 谁在读它 |
| --- | --- | --- |
| 插件契约里「哪一步吃哪个输入文件」 | `lib/plugin.js` · `const INPUT_FILES = {` | `lib/board.js`（标语义输入、给界面 `layoutStep`）、`lib/confirm.js`（写回之后的续跑锚点） |
| 任务与运行状态的中文名 | `lib/board.js` · `function stateLabelOf(` | 看板任务行（`publicTask`）、动作失败原话、`lib/pending-queue.js`（随条目给出 `stateLabel`） |
| 停点 / 失败那一行的措辞 | `ui/src/app/failure-note.tsx` · `export function failureTitle(` | 说明卡（同文件的 `FailureNote`）、看板任务行 |
| 「运行中不给续跑」的判据与说法 | `ui/src/lib/task-state.ts` · `export function isInFlight(`、`export function inFlightNote(` | 待确认面板 |
| 收图的四条判据（空 / 读不出 / 太大 / 不是 PNG·JPEG） | `lib/design-image.js` · `function requireBitmap(` | 暂存（`stage`）与存图（`save`） |
| 先选的位图落地结果 | `lib/design-image.js` · `function installStaged(` | `lib/board.js`（写到任务行的 `designImage`） |
| 待确认清单的取数（含三张草稿与叫 AI 出候选） | `ui/src/app/use-pending-inputs.ts` · `api.pending(` | 待确认面板（取数只有这一处）；正常自动流程不显示，只在模型无法补齐时作为兜底 |
| 面板动作的骨架（置忙 → 清旧错 → 跑 → 收尾） | `ui/src/app/use-action-runner.ts` · `export function useValueRunner(` | `useActionRunner`（同文件）、`use-task-actions.ts`、`use-plugin-sources.ts`、`use-plugin-update.ts`、`board-page.tsx`、`design-image-card.tsx`、设置页（`update-card` / `codex-card` / `runtime-panel` / `source-dialog` / `settings-agent-panel`） |
| 界面唯一的网络出口 | `ui/src/lib/api.ts` · `fetch(` | 所有界面件（别的文件不直接发请求） |
| 先选的位图暂存在哪（键是什么） | `lib/design-image.js` · `function stagedPathOf(` | 暂存（`lib/routes.js` 的 `POST /api/design-image/stage`）、落地与清理（`lib/board.js`）；界面只把任务 id 交给暂存接口，不自己拼键（`ui/src/app/stage-design-images.ts`） |
| 任务级换图门禁（工作目录 / 页面 / 合并中 / 产物已产出） | `lib/board.js` · `function imageWriteBlockOf(` | `GET /api/design-image` 把阻断原因并入 `blocked`；`POST /api/design-image`、`POST /api/design-image/stage` 与暂存件落地共用这一条判据 |
| 位图尺寸不符时那两个数怎么写 | `lib/design-image.js` · `function sizeMismatchText(` | 存图被拒的原话（同文件的 `save`）、看板任务行上那句提示（`lib/board.js`） |
| 「要当文件名的一段名字」的收口（空 / 非法分开说） | `lib/name-safety.js` · `function requireSafeName(` | 页面 Target 与任务 id 两个包装（同文件）；工程目录存在性走同文件的 `requireProjectDirectory` |
| 「这一份与清单对不上的是哪几个文件」 | `lib/update.js` · `function mismatchedFiles(` | 切换前的校验（同文件的 `apply`）、安装根那一份的核验（`installRootIsVersion`） |
| 「本地这一份」（安装根那一棵树）算不算它声称的那一版 | `lib/update.js` · `function installRootIsVersion(` | `stagedReachable`（设置页与探活都读它）；结论缓存（含「核不出来」那种），作废只有两处、跟着触发点走：写指针（`writePointer`，切换与回退共用）与写下一版的清单（`writeVersionManifest`，检查与下载共用）；读盘出错不抛、按「认它」处理 |
| 顶栏那条入口该对哪一版动作 | `lib/update.js` · `function targetVersionOf(` | `readState`（五态与它同出一处）、`hint()` 的 `target`（顶栏只渲染，不自己比一遍）；被外壳下限挡住的那一版不参与 |
| 这一页哪一步还没跑成（＝没跑完时那个断点） | `lib/page-progress.js` · `function unfinishedStepOf(` | `lib/board.js` 的 `resumeOf` 与 `resumeAllowedOf`（看板快照的 `task.resumeStep` 决定按钮说「继续」还是「重跑一遍」，`task.resumable` 决定给不给入口）；`lib/routes.js` 的 `resumeLive`（运行还在时那条「从断点继续」，Target 按任务认回来的那份读登记表）；`lib/confirm.js` 的写回续跑（与「刚写入的文件所喂的第一步」取更早的那个，不跳过没跑成的那一步） |
| 某一版能不能用在这一台上（外壳下限） | `lib/update.js` · `function usableHere(` | 「这一份可以切过去」（`switchable`：选版与版本表逐行都读它，清单都按 `manifestOf` 取）；与 `apply` 前那一刻的 `versionBlocked` 同源 |
| 布局停点是否属于这个 mode | `lib/pending.js` · `function layoutSection(` | `inspect` 的统一结论；看板语义停点、自动补输入、待确认队列与面板都读这一份，B 路线不产生布局停点 |
| 图标 / 译文 / 术语自动写回的范围 | `lib/autofill.js` · `const canAutoOthers = automation === "auto";` | `assist` 只出候选并等确认；`auto` 写回并续跑；`off` 不调用模型。与设置页、待确认面板同一口径 |
| 位图落地要等的那一步怎么说 | `lib/design-image.js` · `const NO_CANVAS_REASON =` | 界面那一块照后端给的原话显示（`/api/design-image` 的 `blocked`）；A 路线等图停点（`lib/board.js`）也拼这一句；表单指引不提步骤名，只说「流水线产出画板尺寸之后」 |
| 本地记住的值什么时候写回 | `ui/src/app/use-remembered.ts` · `export function useRemembered<` | 两张「新建任务」表单（`ui/src/app/pipeline-page.tsx`、`board-page.tsx`）、看板筛选（`board-page.tsx`）、只看生效（`ui/src/app/use-only-effective.ts`） |
| 布局分组这一步喂给模型的输入（本层可引用条目 + 本页页面 PNG 的 data URL） | `lib/layout-groups.js` · `function candidatesInput(` | 自动补输入（`lib/autofill.js`）；模型层（`lib/ai.js`）只吃这个入参，不碰磁盘 |
| 布局待办、自动续跑与空表写回的前置判据 | `lib/layout-groups.js` · `needsGroups: hasImage && !hasGroups && pendingCandidates.available` | `inspect` 的统一结论（待确认面板、看板 done 分支）；`save` 的写回校验读同一份 `layout-group-candidates.json` |
| 分组表里能写哪些 ref（这一层的条目清单在哪、为空算不算参与分组） | `lib/layout-candidates.js` · `function refsOf(`、`function noCandidatesReason(`、`const CANDIDATES_MIN_PLUGIN_VERSION =` | 喂模型（`lib/layout-groups.js` 的 `candidatesInput`）、写回校验与候选清理（同文件的 `validateGroups` / `cleanGroups`） |
| 跨仓同一套判据：ref 必须在本层条目里 / 不参与分组的层只许空表 | `lib/layout-groups.js` · `不在本层条目里: `、`这一层的条目清单是空的（这一层不参与分组）` | 写回校验（`validateGroups`）；插件那侧是 `gen-mw-wpf-layout.js` 的 `declaredGroups` / `requireNoDeclaredGroups` —— 两边的关键句要一起改 |
| 只有一个字符串字段的地方那句整句（原因 + 怎么做） | `lib/errors.js` · `function failureSentence(` | `lib/mcp-token.js`（缺 token 那件事的整句）、`lib/board.js`（任务行上的 `error` / `designImage` 四处 catch）、`lib/autofill.js`（这一步的输入读不出来时交回给人的那句）；界面那侧同一条规矩在 `ui/src/lib/describe-failure.ts` 的 `failureText`（两端口径一起改） |
| 一个 mode 的路线、页面 PNG 与 A 自动入口能力 | `lib/run.js` · `function modePolicies(` | 看板快照直接携带 `modes`；前端表单、详情页、取图与启动编排只查这张表（`ui/src/lib/task-form.ts` 的 `modePolicyOf`），不自行解释 mode 字符串 |
| 先选图、后填链接时哪张图归哪一页 | `ui/src/lib/board-items.ts` · `function pickedForLink<T>(` | 单页面表单用 `allowUnclaimed=true` 读取待认领图；多页面批次必须按各自链接成键。链接是否可建任务仍只由后端 `lib/resolve-target.js` 的 `parseLink` 判 |

