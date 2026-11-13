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
| 待确认面板的草稿来源隔离 | `ui/src/lib/pending-source.ts` · `export function pendingPanelKey(` | 待确认页与流水线详情两个挂载点共用同一来源键；按来源、工程、页面、路线、任务与运行重建，换来源时不沿用上一页草稿 |
| 待确认面板的并发取数 | `ui/src/app/use-pending-inputs.ts` · `const reloadSeq = useRef(` | `reload` 只采用最后一次请求的返回与失败；旧响应不落到当前来源，也不提前清掉新请求的忙碌状态 |
| 面板动作的骨架（置忙 → 清旧错 → 跑 → 收尾） | `ui/src/app/use-action-runner.ts` · `export function useValueRunner(` | `useActionRunner`（同文件）、`use-task-actions.ts`、`use-plugin-sources.ts`、`use-plugin-update.ts`、`board-page.tsx`、`design-image-card.tsx`、设置页（`update-card` / `codex-card` / `runtime-panel` / `source-dialog` / `settings-agent-panel`） |
| 界面唯一的网络出口 | `ui/src/lib/api.ts` · `fetch(` | 所有界面件（别的文件不直接发请求） |
| 先选的位图暂存在哪（键是什么） | `lib/design-image.js` · `function stagedPathOf(` | 暂存（`lib/routes.js` 的 `POST /api/design-image/stage`）、落地与清理（`lib/board.js`）；界面只把任务 id 交给暂存接口，不自己拼键（`ui/src/app/stage-design-images.ts`） |
| 任务级换图门禁（工作目录 / 页面 / 合并中 / 产物已产出） | `lib/board.js` · `function imageWriteBlockOf(` | `GET /api/design-image` 把阻断原因并入 `blocked`；`POST /api/design-image`、`POST /api/design-image/stage` 与暂存件落地共用这一条判据 |
| 位图尺寸不符时那两个数怎么写 | `lib/design-image.js` · `function sizeMismatchText(` | 存图被拒的原话（同文件的 `save`）、看板任务行上那句提示（`lib/board.js`） |
| 「要当文件名的一段名字」的收口（空 / 非法分开说） | `lib/name-safety.js` · `function requireSafeName(` | 页面 Target 与任务 id 两个包装（同文件）；看板建任务、暂存图落地与分组恢复共用页面 Target 校验，工程目录存在性走同文件的 `requireProjectDirectory` |
| 「这一份与清单对不上的是哪几个文件」 | `lib/update.js` · `function mismatchedFiles(` | 切换前的校验（同文件的 `apply`）、安装根那一份的核验（`installRootIsVersion`） |
| 「本地这一份」（安装根那一棵树）算不算它声称的那一版 | `lib/update.js` · `function installRootIsVersion(` | `stagedReachable`（设置页与探活都读它）；结论缓存（含「核不出来」那种），作废只有两处、跟着触发点走：写指针（`writePointer`，切换与回退共用）与写下一版的清单（`writeVersionManifest`，检查与下载共用）；读盘出错不抛、按「认它」处理 |
| 顶栏那条入口该对哪一版动作 | `lib/update.js` · `function targetVersionOf(` | `readState`（五态与它同出一处）、`hint()` 的 `target`（顶栏只渲染，不自己比一遍）；被外壳下限挡住的那一版不参与 |
| 这一页哪一步还没跑成（＝没跑完时那个断点） | `lib/page-progress.js` · `function unfinishedStepOf(` | `lib/board.js` 的 `resumeOf` 与 `resumeAllowedOf`（看板快照的 `task.resumeStep` 决定按钮说「继续」还是「重跑一遍」，`task.resumable` 决定给不给入口）；`lib/routes.js` 的 `resumeLive`（运行还在时那条「从断点继续」，Target 按任务认回来的那份读登记表）；`lib/confirm.js` 的写回续跑（与「刚写入的文件所喂的第一步」取更早的那个，不跳过没跑成的那一步） |
| 某一版能不能用在这一台上（外壳下限） | `lib/update.js` · `function usableHere(` | 「这一份可以切过去」（`switchable`：选版与版本表逐行都读它，清单都按 `manifestOf` 取）；与 `apply` 前那一刻的 `versionBlocked` 同源 |
| 布局停点是否属于这个 mode，等图停点是否排除，缺表与已有表被拒收分别怎么读数 | `lib/pending.js` · `function layoutSection(` | `inspect` 的统一结论；看板语义停点、自动补输入、待确认队列与面板都读这一份，B 路线不产生布局停点，页面 PNG 等图停点只产生补图待办 |
| 布局步骤的失败是否真的属于分组表输入问题（文件在不在、表能不能读、缺表恢复 / 已有表被拒） | `lib/layout-groups.js` · `const hasFile = fs.existsSync(workdir.layoutGroupsPath(`、`const failureCode = groupFailureCodeOf(` | `lib/pending.js` 的 `layoutSection`、`lib/board.js` 的语义停点、`lib/autofill.js` 的自动补输入共用同一份 `inspect` 结论；只有失败步骤就是布局步骤且机器码明确时，才产生补表待办或覆盖现有表的快捷动作 |
| 布局分组写入口的服务端准入门槛 | `lib/layout-groups.js` · `function requireRecovery(layout)` | `lib/layout-recovery.js` 是人工与自动恢复的唯一编排；普通确认入口带 `groups` 时也经它检查同一停点，调用方不能绕过门禁 |
| 看板任务 / 直跑运行 / 手填条目到待确认查询的唯一映射 | `lib/pending.js` · `const QUERY_FIELDS =`、`function queryOfTask(` | `queryOfTask` / `queryOfRun` / `queryOfManual` 只适配来源；字段集合、空值归一与覆盖顺序共用 `QUERY_FIELDS`，供 `/api/pending`、`lib/pending-queue.js`、`lib/board.js` 与 `lib/autofill.js` 读取。手填来源只保留工程、页面与路线，停点事实只能来自任务或运行 |
| A / B / AB 页面身份的手写 Target 对账 | `ui/src/lib/identity-flow.ts` · `export async function resolveExplicitTarget(` | 冲突判据、冲突原话、后端区域拆分与完整性采用只在这里组合；三个入口不再各筛候选或各拼 fallback |
| B / AB 新建任务的显式 Target 对账 | `ui/src/app/task-creation-entry.ts` · `async function reconcileOtherItems(` | 看板弹窗与流水线页的非 A 请求都先逐行取链接候选并调用 `resolveExplicitTarget`，通过后才进入各页面的 `otherRequest` |
| Target 是否同时具备区域前缀与语义名 | `lib/identity.js` · `function targetPartsOf(` | `/api/identity/prefix` 直接返回 `previewUi` / `semanticName` / `complete`；流水线 A 与 B / AB 的手写 Target 都读这份结论，再交给 `ui/src/lib/identity-pick.ts` 的同一采用判据；登记候选与写回接口也用这份结论 |
| A 路线页面身份的优先级与模型边界（手写 Target / 机械区域身份 / 模型语义名） | `ui/src/app/prepare-pipeline-items.ts` · `export async function preparePipelineAItems(` | 看板行手写 Target 优先并走 `prepareLinkIdentity` 的统一身份对账；没有手写时采用项目唯一区域的机械身份；模型补语义名只读 `ui/src/lib/task-form.ts` 的 `adoptsIdentityWithoutConfirm`（仅自动层级）。A-only 单页表单不读取隐藏旧 Target |
| 布局分组停点的机器分类 | `lib/layout-groups.js` · `const GROUP_FAILURE_CODE` | 只认插件失败摘要首行里的 `LAYOUT_GROUPS_MISSING` / `LAYOUT_GROUPS_REJECTED`；中文失败原话只展示，不参与恢复入口判据 |
| 单页表单何时允许「先选图、后填链接」 | `ui/src/lib/board-items.ts` · `function singlePageAllowsUnclaimedImage(` | 选图层、缺图门禁与建任务后的暂存读取同一结论；多页批次不把待认领图复制给任意一页 |
| 任务创建失败时界面拿到的原因 | `ui/src/app/task-creation-entry.ts` · `const TASK_CREATION_FAILED =` | 两个新建入口共用；请求准备返回空原因时也落到这一句，页面不会再出现空错误 |
| 图标 / 译文 / 术语自动写回的范围 | `lib/autofill.js` · `const canAutoOthers = automation === "auto";` | `assist` 只出候选并等确认；`auto` 写回并续跑；`off` 不调用模型。与设置页、待确认面板同一口径 |
| 位图落地要等的那一步怎么说 | `lib/design-image.js` · `const NO_CANVAS_REASON =` | 界面那一块照后端给的原话显示（`/api/design-image` 的 `blocked`）；A 路线等图停点（`lib/board.js`）也拼这一句；表单指引不提步骤名，只说「流水线产出画板尺寸之后」 |
| 本地记住的值什么时候写回 | `ui/src/app/use-remembered.ts` · `export function useRemembered<` | 两张「新建任务」表单（`ui/src/app/pipeline-page.tsx`、`board-page.tsx`）、看板筛选（`board-page.tsx`）、只看生效（`ui/src/app/use-only-effective.ts`） |
| 布局分组这一步喂给模型的输入（本层可引用条目 + 本页页面 PNG 的 data URL） | `lib/layout-groups.js` · `function candidatesInput(` | 自动补输入（`lib/autofill.js`）；模型层（`lib/ai.js`）只吃这个入参，不碰磁盘 |
| 布局待办、自动续跑与空表写回的前置判据 | `lib/layout-groups.js` · `const recoverable = query?.imageStop !== true &&`、`const sourceAllowsRecovery =` | `inspect` 的统一结论（`lib/pending.js`、看板状态判定与 `lib/autofill.js`）；手填无状态来源按有图无表恢复，等待/失败来源还必须命中布局步骤停点与缺表/被拒证据 |
| 布局自动分组动作能不能执行 | `lib/layout-groups.js` · `function suggestBlocker(`、`function regroupOf(` | `inspect` 直接返回 `regroup.allowed / code / reason / hint`；待确认面板按钮与自动层级读同一份结论，输入不足时只走空表恢复 |
| 等图停点的进入结果 | `lib/board.js` · `const IMAGE_GATE_NOT_ENTERED =` | `enterPipelineAImageStop` 统一返回 `{ entered, changed }`；运行收尾与登记表对表只按具名结论提前返回或继续，不再用 `null / false` 区分两种“没有改动” |
| 登记表对表的显式事实与结算分派 | `lib/board.js` · `function registryFactsOf(` | `reconcileTask` 与运行 done 分支共用 `{ empty, complete, failed }`；`settleDone` 只消费同一份事实，不重复判断是否跑满 |
| 看板任务状态推进与快照读取 | `lib/board.js` · `function advanceTask(` | `snapshot` 只做只读投影；定时器、启动恢复与测试显式推进统一走 `advanceTask`，有运行跟运行，没有运行才按登记表结算 |
| 待确认写入与布局恢复共用哪一条来源解析 | `lib/routes.js` · `function requireConfirmSourceOf(` | 普通 `/api/confirm` 与布局恢复接口先从任务 / 运行 / 手填来源解析出一份 query；布局恢复的检查、候选与写回统一由 `lib/layout-recovery.js` 编排 |
| 布局恢复从停点检查到候选与写回的唯一编排 | `lib/layout-recovery.js` · `function suggestGroups(source, options)` | 人工重新分组与自动补输入共用恢复门禁、`candidatesInput`、模型调用与 `commitFromSource`；调用方不再各拼一套请求与续跑字段 |
| 已解析来源如何驱动写盘 | `lib/confirm.js` · `function commitFromSource(` | 写盘工程目录、页面与续跑运行只取 `source.query` / 来源任务；请求体只提供本次输入，不再决定写到哪一页 |
| 页面图文件身份 | `lib/design-image.js` · `function fileIdentityOf(file)` | 预览地址的换图戳与布局停点缓存签名共用文件大小和取整后的修改时间，避免同一身份在两处各读一遍 |
| 命名表可编辑与提交载荷 | `ui/src/app/pending-panel.tsx` · `const namingEditable =` | 缺名字或当前表有重名时，命名表可编辑；同一判据决定提交是否携带 `naming`，服务端修复仍由 `pruneNaming` 单独表示 |
| 待确认面板的提交载荷与忙碌/失败收尾 | `ui/src/app/pending-panel.tsx` · `const submitInputs = useCallback(` | 「确认并继续」「只写入」「按空表重写」「重新自动分组」共用同一份字段组装、来源路线与状态收尾，只在最后按提交类型选择接口 |
| 新建任务按钮名 | `ui/src/lib/task-form.ts` · `export function startActionLabel(` | `new-task-card.tsx` 的按钮、流水线页提示与成功提示都读这一份名称；路线需要页面 PNG 时是「创建并开始」，否则是「加入看板并开始」 |
| 显式 `runId` 的待确认来源 | `lib/run.js` · `function summary(id)` | `lib/routes.js` 的 `pendingSourceOf` 按运行 id 直查单次摘要；不看按工程 + Target 去重后的 `runs.list()`，来源不存在时直接报错，不退化成手填查询 |
| 分组表里能写哪些 ref（这一层的条目清单在哪、为空算不算参与分组） | `lib/layout-candidates.js` · `function refsOf(`、`function noCandidatesReason(`、`const CANDIDATES_MIN_PLUGIN_VERSION =` | 喂模型（`lib/layout-groups.js` 的 `candidatesInput`）、写回校验与候选清理（同文件的 `validateGroups` / `cleanGroups`） |
| 跨仓同一套判据：ref 必须在本层条目里 / 不参与分组的层只许空表 | `lib/layout-groups.js` · `不在本层条目里: `、`这一层的条目清单是空的（这一层不参与分组）` | 写回校验（`validateGroups`）；插件那侧是 `gen-mw-wpf-layout.js` 的 `declaredGroups` / `requireNoDeclaredGroups` —— 两边的关键句要一起改 |
| 只有一个字符串字段的地方那句整句（原因 + 怎么做） | `lib/errors.js` · `function failureSentence(` | `lib/mcp-token.js`（缺 token 那件事的整句）、`lib/board.js`（任务行上的 `error` / `designImage` 四处 catch）、`lib/autofill.js`（这一步的输入读不出来时交回给人的那句）；界面那侧同一条规矩在 `ui/src/lib/describe-failure.ts` 的 `failureText`（两端口径一起改） |
| 一个 mode 的路线、页面 PNG 与 A 自动入口能力 | `lib/run.js` · `function modePolicies(` | 看板快照直接携带 `modes`；前端表单、详情页、取图与启动编排只查这张表（`ui/src/lib/task-form.ts` 的 `modePolicyOf`），不自行解释 mode 字符串 |
| 先选图、后填链接时哪张图归哪一页 | `ui/src/lib/board-items.ts` · `function pickedForLink<T>(` | 单页面表单用 `allowUnclaimed=true` 读取待认领图；多页面批次必须按各自链接成键。链接是否可建任务仍只由后端 `lib/resolve-target.js` 的 `parseLink` 判 |

