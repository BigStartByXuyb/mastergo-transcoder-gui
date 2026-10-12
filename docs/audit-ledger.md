# 复核台账（唯一权威）

语义审计（CI 的 `semantic-audit`）给的每条意见都进这张表，一行一条：**这条说什么、最后怎么处置、落在哪**。
下一轮先对这张表 —— 同一族不再重开；不修的写明理由，不留「待看」。

处置只有三种：`已收`（改了）、`不修`（写清为什么不改）、`独立一轮`（单独做，写清做哪一圈）。
`tests/consistency.test.js` 的「复核台账每行都有处置」只核这一条格式，不判内容。

| 轮次 | id | 说什么（族） | 处置 | 落在哪 / 为什么不改 |
| --- | --- | --- | --- | --- |
| 2026-10-10 第 1 遍 | BLOCK-001 | 删 `HUMAN_INPUT_FILES` 时漏了一处引用，兜底判据形同不存在 | 已收 | `lib/board.js` 的 `contractWantsHumanInput` 改走同一处判据（`stepsByContract().human`） |
| 2026-10-10 第 1 遍 | REVIEW-001 | 位图落地失败信息粘滞，且每个 tick 重复落盘 | 已收 | 独立成 `task.designImage`：同值不落盘、条件解除自清（`lib/board.js`） |
| 2026-10-10 第 1 遍 | REVIEW-002 | 「写入并续跑」两个面板门禁不一致 | 已收 | 判据与说法收进 `ui/src/lib/task-state.ts` 的 `isInFlight` / `inFlightNote` |
| 2026-10-10 第 1 遍 | REVIEW-003 | 步骤名 `layout` 前后端各硬编码一处 | 已收 | 按插件契约的 `Inputs` 找同一步（`lib/plugin.js` 的 `INPUT_FILES`） |
| 2026-10-10 第 2 遍 | REVIEW-001 | 看板对契约事实的缓存不随插件切换失效 | 已收 | 去掉缓存，每次向 `lib/run.js` 的 `contract()` 取 |
| 2026-10-10 第 2 遍 | REVIEW-002 | 待确认页一处恒真判断 | 已收 | 去掉多余的 `active &&`（`ui/src/app/review-page.tsx`） |
| 2026-10-10 第 2 遍 | 非阻断 | 状态名有前后端两份文案表 | 已收 | 收进 `lib/board.js` 的 `stateLabelOf`，队列随条目给 `stateLabel` |
| 2026-10-10 第 2 遍 | 非阻断 | 没人用的 `PendingPanelHandle` 导出与 `onState` 回调 | 已收 | 删掉（`ui/src/app/pending-panel.tsx`） |
| 2026-10-10 第 3 遍 | REVIEW-001 | 「12 步」写死在文案里 | 已收 | 改成「流水线各步都跑完了」；数只有契约一个来源 |
| 2026-10-10 第 3 遍 | REVIEW-002 | `reloadKey` 只有一个入口传，待确认页那条永不重读 | 已收 | 重读判据收进面板（依赖状态与来源），参数删掉 |
| 2026-10-10 第 3 遍 | 非阻断 | `lib/pending.js` 同一份译文清单 / 术语表读两遍 | 已收 | 读一次进局部变量 |
| 2026-10-10 第 3 遍 | 非阻断 | `lib/routes.js` 一行缩进异常 | 已收 | 同一次改掉 |
| 2026-10-10 第 4 遍 | REVIEW-001 | 「新组名不能为空」三处，面板那处永远命不中 | 已收 | 删掉不可达那处；校验留在按钮 `disabled` 与 `addGroup` |
| 2026-10-10 第 4 遍 | REVIEW-002 | 两个 hook 手写了一遍已抽出的动作骨架 | 已收 | 都改走 `useValueRunner`（骨架加一个可选的失败反应） |
| 2026-10-10 第 4 遍 | REVIEW-003 | 同一份待确认清单两条入口各取一次 | 已收 | 页面不再取（挂载判据改读后端结论 `state === "waiting"`），取数留在面板 |
| 2026-10-10 第 4 遍 | REVIEW-004 | 待确认面板一个组件管太多（取数 / 三张表草稿 / 设置探测 / 载荷拼装） | 已收 | 见「第 15 遍」那行：拆出 `ui/src/app/use-pending-inputs.ts` |
| 2026-10-10 第 4 遍 | 非阻断 | 看板页自己一套轮询，与 `use-board-tasks` 两份 | 已收 | 收进 `use-board-tasks`（失败原因也在这条线上给） |
| 2026-10-10 第 4 遍 | 非阻断 | `ui/src/lib/step-rows.ts` 的 `StepRow` 绕经 `task-steps.tsx` 再导出 | 已收 | 见「第 15 遍」那行：消费者直接从 `@/lib/step-rows` 取 |
| 2026-10-10 第 5 遍 | 001 | 看板任务行的失败文案自己拼一份，与 `failureTitle` 在「没进步骤就失败」时说法分叉 | 已收 | 两个分支都经 `failureTitle` 取标题（`ui/src/app/board-task-table.tsx`） |
| 2026-10-10 第 5 遍 | 002 | 看板页自带一条与 `useValueRunner` 同形的动作骨架 | 已收 | 改走共用骨架；任务表要的「跑并把看板换上去」形状只留一层适配（`ui/src/app/board-page.tsx`） |
| 2026-10-10 第 5 遍 | 非阻断 | `use-layout-groups.ts` 两段注释说同一件事 | 已收 | 合成一处 |
| 2026-10-10 第 5 遍 | 非阻断 | `review-page.tsx` 一处缩进多一层 | 已收 | 同一次改掉 |
| 2026-10-10 第 5 遍 | 非阻断 | `review-page.tsx` 注释说「消失后面板继续留着」与行为不符 | 已收 | 注释改成实际行为（选中那条从列表消失就把面板收起来） |
| 2026-10-10 第 6 遍 | REVIEW-001 | 待确认面板一个组件同时承担取数、三张草稿、设置探测、AI 预填、载荷拼装与渲染 | 已收 | 见「第 15 遍」那行（与第 4 遍 REVIEW-004 同族） |
| 2026-10-10 第 6 遍 | REVIEW-002 | 区域页的步数分母在登记表为空时回落到写死的 `12` | 已收 | 分母只取现成来源：后端的进度分母（契约步数），没有就退回登记表步数（`ui/src/app/area-page.tsx`） |
| 2026-10-10 第 7 遍 | REVIEW-001 | 「Target 可留空」与「新建时可选设计稿位图」两条口径相冲：留空又选图必然中止建任务 | 已收 | 判据收进 `ui/src/lib/task-form.ts` 的 `imageNeedsTarget`：Target 空着就不给选图（表单说同一句），提交前按同一句判据跳过暂存 |
| 2026-10-10 第 7 遍 | REVIEW-002 | 同一个「待确认」停点有两处独立发起「自动补输入并续跑」 | 已收 | 看板任务由服务端发起（`lib/autofill.js` 读同一个 automation 设置），面板只对没有看板任务的条目发起（`automation === "auto" && !taskId`） |
| 2026-10-10 第 8 遍 | REVIEW-001 | 面板指引写「设置 → AI Agent 的自动化层级」，那一页并没有这个开关 | 已收 | 「自动化层级」落到设置 → AI Agent（关 / 辅助 / 自动），面板那句指向它 |
| 2026-10-10 第 8 遍 | REVIEW-002 | 同一道门禁两份不完整的说法，后端那句会给出去与界面相反的原因 | 已收 | 完整条件只在 `lib/autofill.js` 的 `fill()` 一处，不满足时逐条列出「哪几条没满足」；界面只说「这是全局开关」，不再复述条件 |
| 2026-10-10 第 8 遍 | REVIEW-003 | 全局开关挂在「每一页/每个任务」的面板里，界面上没交代作用域 | 已收 | 面板那一行写明「全局：对所有页生效」，并指向设置页 |
| 2026-10-10 第 8 遍 | 非阻断 | 布局读数把设置读绑在 `Promise.all` 上：每推进一步多打一次 `/api/settings`，设置读失败会连带布局读数失败 | 已收 | 「自动通过」的值随 `/api/layout-groups` 一起回来，面板不再取设置 |
| 2026-10-10 第 8 遍 | 非阻断 | 「自动通过」开关没有 `disabled`、`toggleAutoPass` 没有防重入 | 已收 | 写盘期间开关禁用（写盘失败仍拨回原值） |
| 2026-10-10 第 8 遍 | 非阻断 | `lib/pending-queue.js` 的看板来源判据用路径前缀比较，没带分隔符 | 已收 | 见「第 15 遍」那行（合并在第 17 遍又补齐大小写归一） |
| 2026-10-10 第 9 遍 | REVIEW-001 | 「取数 + 固化快照」这句步骤说法在前后端各硬编码一处 | 已收 | 那句只在 `lib/design-image.js` 的 `NO_CANVAS_REASON` 一处（后端原话给界面显示）；表单指引不再提步骤名，并登进 `docs/facts.md` |
| 2026-10-10 第 9 遍 | REVIEW-002 | 设置页 Agent 面板的两个即时保存动作各手写了一遍动作骨架 | 已收 | 都改走 `useValueRunner`（一个忙位标记，失败仍是同一处那句话） |
| 2026-10-10 第 9 遍 | 非阻断 | `lib/name-safety.js` 头注释说「两条判据」，正文列了三项 | 已收 | 改成「通用判据与收敛函数」（两项判据 + 一个收敛函数） |
| 2026-10-10 第 10 遍 | REVIEW-001 | 「辅助层级＝出候选等你确认」与「布局确认在「自动通过」开着时会直接落盘续跑」两套口径 | 已收 | 层级说明只在设置 → AI Agent 一处，并写明布局那一节按它自己的「自动通过」开关走；流水线详情只报层级名字，不再复述每层含义 |
| 2026-10-10 第 10 遍 | REVIEW-002 | automation=auto、自动通过没开、又没有别的待补输入时，界面上承诺的那条原因谁也看不到 | 已收 | 那条组合下把「没能自动出分组（哪几条没满足）」作为原因回出来（`lib/autofill.js`），看板写进行上 |
| 2026-10-10 第 10 遍 | 非阻断 | `use-layout-groups.ts` 的 `save` 那段缩进深一层 | 已收 | 同一次改掉 |
| 2026-10-10 第 10 遍 | 非阻断 | `docs/facts.md` 的骨架读者名单漏了设置页 Agent 面板 | 已收 | 补上（顺带补 `board-page.tsx`） |
| 2026-10-10 第 11 遍 | REVIEW-001 | 详情页「给表单还是给详情」由 `formOpen` 状态与路由 `taskId` 两处同时决定（二者恒等） | 已收 | 去掉那份状态，改成从「路由有没有任务 id + 快照里有没有这个任务」派生（`ui/src/app/pipeline-page.tsx`） |
| 2026-10-10 第 12 遍 | REVIEW-001 | 详情视图里 `step !== ""` 是恒真合取项（外层已经按 `step === ""` 分过屏） | 已收 | 去掉这个合取项（`ui/src/app/pipeline-page.tsx`） |
| 2026-10-10 第 12 遍 | REVIEW-002 | `StepCard` 的 children 兜底渲染永远轮不到（调用方给的是两个条件表达式，children 是数组不是 null） | 已收 | 兜底删掉，`children` 改成必给（没有面板时给 false / null 由调用方决定） |
| 2026-10-10 第 12 遍 | REVIEW-003 | 待确认页把「手填」这件事表达了两遍（`active.manual` 与再判一次列表里有没有它） | 已收 | 只读 `active.manual`（`ui/src/app/review-page.tsx`） |
| 2026-10-10 第 13 遍 | REVIEW-001 | 路线（mode）的展示文案在 `task-form.ts` 与新建卡片各写一份（已经分叉） | 已收 | 下拉项与下面那行说明都从 `MODE_HINT` 一处取（`ui/src/app/new-task-card.tsx`） |
| 2026-10-10 第 13 遍 | REVIEW-002 | 「画板尺寸还不知道」在同一张位图卡片里说了两遍，本地那句还绕过了真值源 | 已收 | 去掉本地改写，只说后端给的原话（`ui/src/app/design-image-card.tsx`） |
| 2026-10-10 第 13 遍 | 非阻断 | 位图卡片自己手写了一遍动作骨架 | 已收 | 两个动作都改走 `useValueRunner`；`docs/facts.md` 的读者名单补上它 |
| 2026-10-10 第 13 遍 | 非阻断 | `lib/ai.js` 的候选只去重成员不重组名，同名组要等写回时才被拒 | 已收 | 见「第 15 遍」那行：候选清理收进 `lib/layout-groups.js` 的 `cleanGroups` |
| 2026-10-10 第 14 遍（合并后） | REVIEW-001 | 读画板尺寸时内联重写了「容错读 JSON」，绕开了 `lib/workdir.js` 的单源 | 已收 | `readCanvas` 改调 `workdir.readJsonIfExists`（`lib/design-image.js`） |
| 2026-10-10 第 14 遍（合并后） | REVIEW-001 | `waitingCounts` 返回值里的 `layout` / `total` 在生产代码里没有读取方 | 已收 | 只留面板真正用的两节（`ui/src/lib/task-state.ts`），用例同步 |
| 2026-10-10 第 15 遍 | 第 4/6 遍的「独立一轮」 | 待确认面板一个组件同时管取数、三张草稿、设置探测、AI 预填、载荷拼装与渲染 | 已收 | 拆出 `ui/src/app/use-pending-inputs.ts`（取数 + 三张草稿 + 叫 AI + 载荷拼装 + 设置探测）；面板只留渲染与提交编排（631 → 498 行），忙位/失败也分成这条数据线与提交两处再合成显示 |
| 2026-10-10 第 15 遍 | 第 4 遍「不修」 | `ui/src/lib/step-rows.ts` 的 `StepRow` 绕经 `task-steps.tsx` 再导出 | 已收 | 消费者直接从 `@/lib/step-rows` 取，`task-steps.tsx` 不再二次导出 |
| 2026-10-10 第 13 遍「不修」 | 非阻断 | `lib/ai.js` 的候选只去重成员不重组名，同名组要等写回时才被拒 | 已收 | 候选清理收进 `lib/layout-groups.js` 的 `cleanGroups`（同名组只留第一个 + 跨组去重 + 去掉成员不够的组），ai.js 只调它 |
| 2026-10-10 第 8 遍「不修」 | 非阻断 | `lib/pending-queue.js` 的看板来源判据用路径前缀比较，没带分隔符 | 已收 | 工作目录结尾补分隔符再比前缀（`D:\work2` 不再被 `D:\work` 命中） |
| 2026-10-10 第 16 遍 | REVIEW-001 | 新 hook `use-pending-inputs` 又手写了一遍动作骨架 | 已收 | 取数与叫模型都改走 `useValueRunner`（两个配置同一份骨架；叫模型那份的失败话前面补「可以人工填」） |
| 2026-10-10 第 16 遍 | REVIEW-002 | 命名表的 `fromDsl` 口径在同一文件里写了两份 | 已收 | 「命名表草稿 → 提交形状」收成 `namingItemsOf` 一处，人填与模型出候选共用 |
| 2026-10-10 第 17 遍 | REVIEW-001 | 看板来源前缀比较丢了大小写归一（Windows 上会误判来源） | 已收 | 工作目录去尾分隔符、补一个、统一小写；比较时给 root 也补分隔符 —— 按整段路径比（`lib/pending-queue.js`），用例补了「work 不吃 work2 + 大小写不敏感」 |
| 2026-10-10 第 17 遍 | REVIEW-002 | 译文与术语两个填充函数是同形两份实现 | 已收 | 收成 `fillTextMap` 一处（问模型、落草稿、交回填了的那些），两类只是取哪个字段、写哪张草稿不同 |
| 2026-10-10 第 18 遍 | REVIEW-001 | 译文与术语的载荷拼装是同形两份，「非空才算填过」写了两遍 | 已收 | 收成 `textMapPayload` 一处 |
| 2026-10-10 第 18 遍 | REVIEW-002 | 新 hook 把三张草稿的原始 state 与 setState 交出去，面板照内部形状改 | 已收 | 只给意图级落点：`setName` / `setText` / `setGlossaryOf`（读还是读那三张表），面板不再拼内部记录 |
| 2026-10-10 第 19 遍 | REVIEW-001 | 「只收非空的载荷」在同一文件里写了两份（候选填充与载荷拼装） | 已收 | 候选填充也走 `textMapPayload`（`use-pending-inputs.ts` 一处） |
| 2026-10-10 第 19 遍 | REVIEW-002 | busy 键名是钩子与面板之间的隐式字符串协议 | 已收 | 钩子侧导出 `PENDING_BUSY`（load / icons / translations / glossary），面板侧提交那条用本文件的 `SUBMIT_BUSY`；两边都不再写裸字符串 |
| 2026-10-10 第 20 遍 | REVIEW-001 | 失败提示由两处状态合成时，旧的钩子失败会盖住新的提交失败 | 已收 | 提交开始时先清掉数据线那侧的旧失败（`use-pending-inputs` 的 `clearFailure`） |
| 2026-10-10 第 21 遍 | REVIEW-001 | 面板把整个 `inputs` 放进 `submitWith` 的依赖（回调每次渲染都重建、自动出候选的 effect 跟着重跑） | 已收 | `clearFailure` 本身做成稳定函数，面板只依赖它，不依赖整个 `inputs` |
| 2026-10-10 第 22 遍 | REVIEW-001 | 失败清理只做了单向：数据线成功刷新后，旧的提交失败仍留在界面上 | 已收 | 失败只留一个槽（`use-pending-inputs` 的 `writeFailure` / `clearFailure`）：谁开始干活谁先清，面板的提交也写这同一个槽，不再两处合成 |
| 2026-10-10 第 23 遍 | REVIEW-001 | 暂存件的清理只盖住两条移除路径，按区域清空任务时漏清 | 已收 | 移除统一走 `lib/board.js` 的 `dropTasks`：先算留下哪些，再让走掉的把暂存件一起带走 |
| 2026-10-10 第 24 遍 | REVIEW-001 | 共用选图框不复位 `input.value`，移除后选同一份文件不触发 change | 已收 | 选完清 value 收进 `ui/src/app/use-file-pick.ts`，选图框与任务详情那张图共用 |
| 2026-10-10 第 24 遍 | REVIEW-002 | 批量暂存遇到第一张失败就中止，后面的图被静默丢弃 | 已收 | 记下第一条原话但继续送完其余几张（`ui/src/app/stage-design-images.ts`） |
| 2026-10-10 第 25 遍 | REVIEW-001 | 「只有 A 路线读图」只在渲染时判，切成 B 之后选的图照样被暂存 | 已收 | 提交侧补同一判据：`stagePickedImages` 过 `modeTakesRoute` 再送 |
| 2026-10-10 第 26 遍 | REVIEW-001 | 暂存失败的提示塞进看板横幅（标题对不上，且轮询一到就清） | 已收 | 改成两个入口同一句 toast：后端原话 + `STAGE_FAILED_NOTE` |
| 2026-10-10 第 27 遍 | REVIEW-001 | 任务 id 的校验把页面 Target 的包装又抄了一份 | 已收 | 抽 `requireSafeName` 一处，两个包装只留各自文案（`lib/name-safety.js`） |
| 2026-10-10 第 27 遍 | REVIEW-002 | `addTasks` 把建任务与逐张暂存糅在一个动作里 | 已收 | 配图抽成 `picksForCreated`，暂存只留一次调用 |
| 2026-10-10 第 28 遍 | REVIEW-001 | 模块从 `lib/` 搬到 `app/` 之后，四处注释与台账仍写旧路径 | 已收 | 四处对齐；新增门禁「说明里的前端路径都在」（`tests/consistency.test.js`） |
| 2026-10-10 第 29 遍 | REVIEW-001 | 两个新建入口各自写一遍「过门禁 → 暂存 → 弹错」 | 已收 | 整段编排收进 `ui/src/app/stage-design-images.ts` 的 `stagePickedImages`，页面只传 picks |
| 2026-10-10 第 30 遍 | REVIEW-001 | 新门禁的真值源在 `gates.md` 里少列了仓库根 `README.md` | 已收 | 那一行补上仓库根 README |
| 2026-10-10 第 30 遍 | REVIEW-002 | 暂存件的删除在 `design-image.js` 里有两份写法 | 已收 | `installStaged` 两处内联删除改成调 `discardStaged` |
| 2026-10-10 第 31 遍 | REVIEW-001 | 创建任务弹窗自己写了一份路线文案，与 `MODE_HINT` 分叉 | 已收 | 路线这一项收成 `ui/src/app/mode-field.tsx`，两个入口共用 |
| 2026-10-10 第 32 遍 | REVIEW-001 | 流水线页改链接不清已选图，与看板按行裁图不一致 | 已收 | 两个入口统一成「按链接记」：`keepPickedImages` / `withPickedImage` / `pickedForLink` 一处 |
| 2026-10-10 第 33 遍 | REVIEW-001 | 「页面变了就裁图」两份判据还不一致（一个看链接、一个看链接 + 页面名） | 已收 | 判据收到一处：图跟着链接走，页面名改了还是同一页 |
| 2026-10-10 第 34 遍 | REVIEW-001 | 按链接置入/移除一张图在两个页面各写一份 | 已收 | 置入与裁剪都在 `ui/src/lib/board-items.ts` |
| 2026-10-10 第 35 遍 | REVIEW-001 | `created` 在调用点恒非空，那层判空是永远走不到的分支 | 已收 | 去掉 `?? ""` 与 `&& created`（建不出任务时后端不回成功） |
| 2026-10-10 第 35 遍 | REVIEW-002 | 同一处清理失败，`dropTasks` 兜住、`installStaged` 却变成「落地失败」 | 已收 | 兜底收进 `discardStaged` 自己一处 |
| 2026-10-10 第 36 遍 | REVIEW-001 | 先选图、后填链接时，单任务表单会把选好的图丢掉 | 已收 | 还没填链接时选的那一份记在「待认领」那一格，链接一填就归它 |
| 2026-10-10 第 37 遍 | REVIEW-001 | 待认领槽与链接槽并存：移除后旧图重现、换页后还跟着走 | 已收 | 置入/移除都先清掉待认领那一格（待认领槽只留一份），并补用例 |
| 2026-10-10 第 38 遍 | REVIEW-001 | 暂存件读不出尺寸时写成「图 0×0」，把两条事实混成一条 | 已收 | `installStaged` 分开回 `mismatch` 与 `unreadable`，行上说法各一句 |
| 2026-10-10 第 39 遍 | REVIEW-001 | 「某链接配哪张图」的解析写了两份，还抄了另一模块的私有哨兵 | 已收 | `picksForCreated` 也走 `pickedForLink` |
| 2026-10-10 第 40 遍 | REVIEW-001 | 顶栏标注把目标无条件指向远端版，本地已下好更高的那一版时会把旧版当「有新版」 | 已收 | 目标改成「远端说的与本地已下好的取更新的那个」（`ui/src/lib/update-state.ts` 的 `targetVersion`） |
| 2026-10-10 第 41 遍 | REVIEW-001 | 新缓存的作废漏了 rollback 那条写指针的路 | 已收 | 作废点跟着触发点收成两处：写指针（`writePointer`，切换与回退共用）与写清单（`writeVersionManifest`） |
| 2026-10-10 第 42 遍 | REVIEW-001 | 安装根整树核验落在探活读路径上 | 已收 | 缓存先查（连清单也不每次现读）：核一次的结果留住，探活不读整棵树 |
| 2026-10-10 第 42 遍 | REVIEW-002 | 「该对哪一版动作」在前端再算一遍，与后端 hint 的单源分叉 | 已收 | 算法收进 `readState`（`targetVersionOf`）：五态与 `hint().target` 同出一处，前端只渲染 |
| 2026-10-10 第 43 遍 | 非阻断 | 块注释被顶到 `targetVersionOf` 前面、与 `readState` 前那条重复 | 已收 | 说回 `readState`（两件事各一条），位置对齐 |
| 2026-10-10 第 43 遍 | 非阻断 | `verifyDir` 的 `catch` 里重复赋空串 | 已收 | 声明处已给初值，catch 只留说明 |
| 2026-10-10 第 43 遍 | 非阻断 | 「可切的一份 + 更新的远端版 + 检查失败」时状态是 error，顶栏整块不挂 | 不修 | 状态是唯一真值：远端那句是缓存旧话，最近一次检查失败时先说失败（与改动前同一优先序）；可切那份在设置页版本表里照旧有点「切换」的入口 |
| 2026-10-10 第 43 遍 | 非阻断 | 整树核验缓存的收益只在两次检查之间成立 | 不修 | 复查间隔（10 分钟）远大于探活间隔（5 秒），缓存的意图（探活不读整棵树）成立 |
| 2026-10-10 第 44 遍 | REVIEW-001 | 顶栏把「这一版下没下好」重算了一遍（`ready === target`），与后端五态成两处判据 | 已收 | 改回读后端那一态（`state === "download_ready"` 的定义就是「该动的那一版已在本地」）；顶栏只渲染 |
| 2026-10-10 第 45 遍 | REVIEW-001 | `verifyDir` 的「读不出来当对不上」把写路径的 IO 故障说成内容不符 | 已收 | `verifyDir` 恢复严格（读盘出错照原样抛）；读路径自己兜（`installRootIsVersion` 的 try/catch：核不出来就认它，并记下结论） |
| 2026-10-10 第 46 遍 | REVIEW-001 | 目标版不认「外壳下限挡住」，会把已就绪可切的那一份顶掉 | 已收 | `targetVersionOf` 先看 `blocked`：被挡住的那版不参与（先升外壳那件事在设置页的 `blockedNote` 里说），并补一条「手上有可切的 + 远端被挡住」的用例 |
| 2026-10-10 第 47 遍 | REVIEW-001 | 外壳下限只判了远端那份，已下好可切的那份没判 | 已收 | 判据收进 `usableHere`（与 `apply` 的 `versionBlocked` 同源），`readyVersion` 挑「可切」时也过它；补「同一版重发抬高下限」的用例 |
| 2026-10-10 第 48 遍 | BLOCK-001 | 「某一版可不可以切」有两处判据：版本表逐行那份没过外壳下限 | 已收 | 收成 `switchable`（找得到 + 没被判对不上 + 过得了外壳下限）：`readyVersion` 与 `status().staged[].ready` 同读它，用例补上逐行断言 |
| 2026-10-10 第 49 遍 | 非阻断 | 同一条判据被喂了两种来源的清单（版本自己那份 vs `manifestOf`） | 已收 | 两处都按 `manifestOf` 取；逐行那一趟把缓存读一次传进去。「要不要新开一次运行」也改走同一处 |
| 2026-10-10 第 49 遍 | 非阻断 | `usableHere` 的 `item` 形参没用上；注释里「共用一次读盘」比实际覆盖面宽 | 已收 | 去掉形参；注释改成「逐行那一趟不再每行各读一次」 |
| 2026-10-11 第 1 遍 | BLOCK-001 | 没进步骤的失败在任务详情与失败说明两处各写一段，后者还叫去点已被藏起来的按钮 | 已收 | 收进失败说明一处（`ui/src/app/failure-note.tsx`），并改成中性口径（不把原因一律归到链接 / 页面名） |
| 2026-10-11 第 1 遍 | REVIEW-001 | FieldGroup 只共享外壳，三组标题与提示语仍各写一份 | 已收 | 收成 `field-group.tsx` 的 `FIELD_GROUPS`，两张表单都从那一处取 |
| 2026-10-11 第 1 遍 | REVIEW-002 | 创建任务弹窗一个组件 189 行，同时管编排 / 补全 / 逐行位图 | 已收 | 拆出 `board-identity-fill.tsx` 与 `board-image-rows.tsx` |
| 2026-10-11 第 2 遍 | REVIEW-001 | 抽块时把 `linkLabel` 复制成两份 | 已收 | 挪进 `ui/src/lib/board-items.ts`，两块共用 |
| 2026-10-11 第 2 遍 | REVIEW-002 | 补全面板直接吃 hook 返回值，与同目录既有接法不一致 | 已收 | 改成收 `rows` / `busy` / `onFill` / `onTake` |
| 2026-10-11 第 3 遍 | REVIEW-001 | `resumable` 必填，但步骤视图那个调用点只能传恒定假值 | 已收 | 改成可选：只有总览那份传 |
| 2026-10-11 第 3 遍 | REVIEW-002 | 身份候选按钮的显示规则两处各写一份 | 已收 | 收成 `identity-candidate-button.tsx`，两处只给各自的按钮字 |
| 2026-10-11 第 4 遍 | REVIEW-001 | 「有没有断点」界面拿失败原话猜，后端是按登记表判的 | 已收 | 后端 `resumeOf` 一处算，快照给 `task.resumeStep`；界面只读它 |
| 2026-10-11 第 4 遍 | REVIEW-002 | 同一份快照里登记表与契约各读两遍 | 已收 | `progressOf` 改成由 `publicTask` 把已读的两样传进去 |
| 2026-10-11 第 5 遍 | REVIEW-001 | 登记表里都 ok 但契约没跑满时被当成「没有断点」（跑到一半就断了那种） | 已收 | `resumeOf` 补一支：断点取契约里还没跑过的那一步；续跑计划也跟着从那儿续 |
| 2026-10-11 第 5 遍 | REVIEW-002 | 「契约步骤 → 界面显示名」三处各写一遍、缺省口径还不一样 | 已收 | `titleOfStep` 一处（没 Title 用步骤名），`reconcileTask` 与前端 `step-rows` 都跟这一口径 |
| 2026-10-11 第 5 遍 | 非阻断 | 台账「第 4 遍」两条都编号 REVIEW-001；`canResume(task)` 同一次渲染算两遍 | 已收 | 编号改对；卡片里算一遍再传下去 |
| 2026-10-11 第 6 遍 | REVIEW-001 | `stepRowOf`（单行那条路）没跟 `stepRowsOf` 的标题兜底 | 已收 | 两条路都 `Title \|\| Name` |
| 2026-10-11 第 6 遍 | REVIEW-002 | 实时 job 那条路（`syncTask`）仍自己算失败标题 | 已收 | 也改走 `titleOfStep`：两条路同一口径 |
| 2026-10-11 第 7 遍 | BLOCK-001 | 「一步都没跑过」被新分支算成有断点，那道门禁形同不存在 | 已收 | `resumeOf` 把两支分开：登记表为空 → 没有断点；跑过几步且都 ok、契约没跑满 → 断点是契约里下一步（补一条边界用例） |
| 2026-10-11 第 8 遍 | REVIEW-001 | 被停掉且一步没跑过的任务没有入口也没说明，只剩「移除」 | 已收 | 「没断点就不给入口」只对失败那一支（输入 / 环境问题）；被停掉与等输入照旧给，按钮上没有那一步时写「重跑一遍」 |
| 2026-10-11 第 9 遍 | REVIEW-001 | 按钮上的步名是快照时算的，与真正续跑的起点可能不是同一步 | 已收 | 按钮只说「有没有断点」（继续 / 重跑一遍）；实际从哪一步续由 `planResume` 在点下去那一刻算、写在完成提示里 |
| 2026-10-11 第 10 遍 | REVIEW-001 | `resumeStep` 的说明还写着「按钮上写出那一步」，与实现和台账矛盾 | 已收 | `api.ts` / `lib/board.js` 的说明改成最终行为：按钮只定给不给入口与措辞，实际起点由续跑计划报 |
| 2026-10-11 第 11 遍 | REVIEW-001 | 「实际从哪一步续」的说明只认 `planResume`，还有「运行还在就按运行那一步」那条路 | 已收 | 三处说明按实情写：由续跑那条路在点下去那一刻按当时情况算，快照里的步名不当承诺 |
| 2026-10-11 第 4 遍 | 非阻断 | 两张表单同名字段的标签 / 占位语仍各写一份 | 不修 | 两处的字段集不同（一个是「这一条的 UI 区域」，一个是多行的「默认 Ui 前缀」），各写各的是实情；组标题与提示语已同一处 |
| 2026-10-11 第 12 遍 | REVIEW-001 | 「读这一页运行登记表的步骤」有三份实现，兜底条件已经不一致（看板任务行 / 运行状态 / 写回续跑） | 已收 | 读法收成 `lib/artifacts.js` 的 `stepsOf(query)`（读不出、没登记表、形状不对都当空）：三处同读它，各自那点差异跟着消失 |
| 2026-10-11 第 12 遍 | REVIEW-002 | `confirm.commit` 继续加厚：新增的锚点解析塞进同一个函数，无法独立验证 | 已收 | 锚点抽成纯函数 `resolveResumeStep`（入参：写了哪几类文件 / 步骤契约 / 登记表里的步骤 / 来源运行那几步），`commit` 只写文件与起运行；用例加了一条直接调它的（不写盘、不起运行） |
| 2026-10-11 第 13 遍 | REVIEW-001 | 空分组表那句提示把按钮名写死成「写入分组表并继续」，没有来源运行时那颗按钮其实叫「写入分组表」 | 已收 | 按钮名收成一处（`layout-panel.tsx` 的 `writeLabel`）：按钮、跑着时那句话、空表那句提示都读它 |
| 2026-10-11 第 13 遍 | 非阻断 | `lib/board.js` 用默认桩又复述了一次「没有登记表＝空」，与「读法只有一处」的注释有张力 | 已收 | 去掉默认桩：`artifacts` 与别的依赖一样由装配给（用例给桩）；那两句结论只由 `lib/artifacts.js` 的 `stepsOf` 答 |
| 2026-10-11 第 14 遍 | REVIEW-001 | 同一个登记表依赖在 `board` 与 `confirm` 两处的可选性相反：confirm 缺它时静默降级成空 | 已收 | `confirm` 也改成必给依赖（去掉 `\|\| null` 与调用点的三元兜底）：两处口径一致，装配处漏了会当场炸 |
| 2026-10-11 第 15 遍 | REVIEW-001 | 写回续跑的锚点还留了第二条来源：拿失败原话里的步名猜（与「断点只按登记表判」那条判据冲突） | 已收 | 去掉那条兜底：锚点只有两个来源（写回文件所喂的第一步 / 登记表里没跑成的那一步），都没有就只写入、并说清「这次没有可续跑的锚点」；纯函数用例补一条守住 |
| 2026-10-11 第 16 遍 | REVIEW-001 | 「从哪一步续」仍有两份：「从断点继续」那条 live 路径还按本次失败的步名续 | 已收 | 那条也改读同一处判据（`lib/page-progress.js` 的 `unfinishedStepOf` + `lib/artifacts.js` 的 `stepsOf`）；「已有这一页 → 回到生成 Bundle 清单那一步」这条规则照旧（它是规则，不是猜） |
| 2026-10-11 第 17 遍 | REVIEW-001 | 「从断点继续」两个入口用不同的 Target 读登记表：未给 Target 的任务（Target 由插件推导）在 live 那条读不到登记表，锚点丢掉 | 已收 | live 那条改按任务自己认回来的 Target 读（`task.request.target || request.target`，口径见 `lib/board.js` 的 `adoptTarget`）；顺带把契约读一次传下去，那句断言两处读两遍 |
| 2026-10-11 第 18 遍 | REVIEW-001 | 判据台账那一行的「谁在读它」漏了 `routes` 那条 live 续跑 | 已收 | `docs/facts.md` 那行补上 `lib/routes.js` 的 `resumeLive`（连同它按哪个 Target 读登记表的说明） |
| 2026-10-11 第 19 遍 | REVIEW-001 | 代码注释里的读者清单与判据台账不一致（`unfinishedStepOf` 只写了两个读者） | 已收 | 注释按「读者名单见 docs/facts.md 那一行」写，并把三条读者都列出来（board 的 resumeOf / routes 的 resumeLive / confirm 的 resolveResumeStep） |
| 2026-10-11 第 19 遍 | 非阻断 | `confirm.js` 模块头只写了旧口径；`board.js` 的 `stepsOf(task)` 与 `artifacts.stepsOf(query)` 同名易混 | 已收 | 模块头补上「取更早那个」；board 里那份改名 `taskStepsOf`（与 `artifacts.stepsOf` 区分开） |
| 2026-10-11 第 19 遍 | 非阻断 | `/api/run/status` 仍按 `job.request.target` 读登记表：未给 Target 的任务在这条路上读不到步骤 | 独立一轮 | 要加一个「按 jobId 找看板任务」的入口才谈得上按认回来的 Target 读；本次不动，单独做（`lib/board.js` 加查询 + `lib/routes.js` 那条改读） |
| 2026-10-11 第 21 遍 | REVIEW-001 | `LayoutPanel` 一个组件同时管分组编辑、清单渲染与画布渲染 | 已收 | 画布抽成 `ui/src/app/layout-canvas.tsx`（受控件：`controls` / `canvas` / `imageUrl` / `highlight`），面板只留编辑与写回；悬停态仍在面板（组框与画布同读它） |
| 2026-10-11 第 21 遍 | REVIEW-002 | 控件编号在画布上又算了一遍（`index + 1`） | 已收 | 画布改用 `ui/src/lib/layout-edit.ts` 的 `numberOf`：编号规则只有那一处 |
| 2026-10-11 第 21 遍 | REVIEW-003 | 发 `.jpeg` 会落到 `application/octet-stream`（`lib/http.js` 的表里只有 `.jpg`） | 已收 | `CONTENT_TYPES` 补 `.jpeg: image/jpeg`：与 `lib/design-image.js` 认的三个后缀同口径 |
| 2026-10-11 第 21 遍 | 非阻断 | `imageFile` 回 `{path, name}`，而生产调用方只用 `path` | 已收 | 只回 `path`（用例按 basename 断言） |
| 2026-10-11 第 22 遍 | REVIEW-001 | 画布判不了「这一页有没有图」：无图页面上留一颗点了没反应的「显示设计稿」，点了还会打一次必然失败的请求 | 已收 | 「有没有图」由面板从这一页的读数里判（`lib/layout-groups.js` 转发 `lib/design-image.js` 的 `hasImage`）；没有图就传空串 `imageUrl` —— 画布不挂图、也不给那颗按钮 |
| 2026-10-11 第 22 遍 | REVIEW-002 | 新增的发文件路由把「写头 + `createReadStream().pipe`」又抄了一份（三处） | 已收 | `lib/http.js` 新增 `sendFile(response, file)`：静态件、对话附件、设计稿位图三条发文件的路径都走它 |
| 2026-10-11 第 22 遍 | 非阻断 | `lib/design-image.js` 文件头的「谁在用」没跟上新读者 | 已收 | 补上新路由（发图本身）与 `lib/layout-groups.js` 的转发 |
| 2026-10-11 第 23 遍 | REVIEW-001 | `lib/layout-groups.js` 模块头仍写「有没有图不在这里判」，而 `inspect` 已转发 `canvas` / `hasImage` | 已收 | 模块头改成实况：读数含转发来的画板尺寸与「有没有图」，判据仍只有 `lib/design-image.js` 一处 |
| 2026-10-11 第 23 遍 | 确定性检查 | `contentTypeOf` 成了没人引用的导出（发文件收成 `sendFile` 之后路由不再直接用它的表） | 已收 | 不再导出 `contentTypeOf`：它只作 `lib/http.js` 内部（`sendFile` 与静态件）的类型表读取 |
| 2026-10-11 第 24 遍 | REVIEW-001 | 预览地址与图内容无关：换了图 `<img>` 不会重新取（缩略图继续显示上一张） | 已收 | 「图的身份」（大小-修改时间）由 `lib/design-image.js` 一处算（`stampOf`：`read` 的 `image.stamp` 与 `imageStamp()` 同源），并进 `api.designImageUrl(…, stamp)`；位图卡与布局画布都带上它。用例补一条「换一张 → 地址变」 |
| 2026-10-11 第 24 遍 | 非阻断 | 布局载荷里「有没有图」是布尔、画布又从空串反推；画布的 `total > 0` 是恒真防御 | 已收 | 改成 `imageStamp`（空串＝没有图：一个字段一个意思）；`percent` 去掉恒真那一支 |
| 2026-10-11 第 25 遍 | REVIEW-001 | 发图那条路由只为拿路径，却把整张位图读进了内存（`imageFile` 借 `currentImage`） | 已收 | 「先看哪一张」收成 `currentImagePath`（只看在不在、不读文件）：`currentImage`（要读宽高）/`hasImage`/`imageStamp`/`imageFile` 四条读法共用它，发图那条不再读整张图 |
| 2026-10-11 第 26 遍 | REVIEW-001 | `inspect` 转发画板尺寸时把同一份 DSL 快照读了第二遍 | 已收 | 快照在 `inspect` 里读一次，传给 `readControls`（控件文本）与 `designImage.readCanvas`（画板尺寸）；`readCanvas` 收可选快照，不传才自己读 |
| 2026-10-11 第 27 遍 | REVIEW-001 | 层次图节点 `numbers` 的文档契约与实现语义相反（说的「直接持有」与实际的「自身是控件」不一致） | 已收 | 干脆去掉 `numbers`：后端只给层级（ref / 名字 / 类型 / 方向），号由界面按同一份清单现算 |
| 2026-10-11 第 27 遍 | REVIEW-002 | 控件编号规则后端与前端各一份，注释却说唯一判据在前端 | 已收 | 后端不再算号（同上）：`ui/src/lib/layout-edit.ts` 的 `numberOf` 是唯一一处，画布 / 层次图 / 面上清单三处的号必然一致 |
| 2026-10-11 第 27 遍 | 非阻断 | 空层次图时右边空一列；`useMemo` 依赖恒变形同没缓存；`data-ref` 只被用例读 | 已收 | 没有层次图就不摆第二列；去掉那个 memo（直接算）；`data-ref` 保留当测试钩子（审计认可） |
| 2026-10-11 第 27 遍 | 用户新要求 | 容器显示设计稿层名（「容器 194」）没有信息量 | 已收 | 容器只显示方向 —— 取自设计稿自己的自动布局（`flexContainerInfo.flexDirection`）：横排 / 竖排 / 自由布局；层名与 ref 挪到悬停提示 |
| 2026-10-12 第 28 遍 | REVIEW-001 | 验收记录仍写着「后端层次图每段带上控件号」，与本轮改后的实现相反 | 已收 | 记录改成实况（后端只给层级、号在界面一处算），并把「容器只标方向」一起写进去 |
| 2026-10-12 第 29 遍 | REVIEW-001 | 层次图选中态分存两处（树组件里一份、面板里一份），换页也不重置 | 已收 | 选中态只由面板一处持有（`treePicked` / `treeRefs`）；树改成受控件（`selected` 进来、`onPick(ref, refs)` 出去）；Target 一变就清 |
| 2026-10-12 第 29 遍 | REVIEW-002 | 层次图与画布的用例靠 Tailwind 类名断言高亮，绑在样式实现上 | 已收 | DOM 上给语义钩子：画布框 `data-highlighted`、树行 `data-selected`，用例按属性断言 |
| 2026-10-12 第 30 遍 | REVIEW-001 | 层次图选中态存了两个 state：选中的 ref 与由它派生的高亮 refs | 已收 | 只存「选中了哪一段」（`treePicked`）；要高亮哪些控件由 `ui/src/lib/layout-edit.ts` 的 `refsOfNode` 现算，树组件的 `onPick` 只回 ref |
| 2026-10-12 第 31 遍 | REVIEW-001 | 验收记录把新用例说成覆盖了它并未覆盖的两件事（「再点一下取消」已挪到面板；号也不是后端给的） | 已收 | 记录按用例实际覆盖改写，并把「按 value 显示 / 容器只标方向 / 树里控件与清单一一对应」一起写进去 |
| 2026-10-12 第 31 遍 | 用户新要求 | 层次图上的名字应该用 value（没有 value 才退回控件名） | 已收 | `ui/src/lib/layout-edit.ts` 加 `textOf`（value 只在这一处取，清单与树同源）：树上的控件行先显示 value、末尾带号；容器行照旧只显示方向 |
| 2026-10-12 第 32 遍 | REVIEW-001 | 层次图选中态只在 Target 变化时重置：换工程目录而 Target 同名时会留着上一次的选中 | 已收 | 重置改成跟「工程目录 + Target」这一对走（同一页的身份是这两个一起） |
| 2026-10-12 第 33 遍 | REVIEW-001 | 验收记录里的前端用例数与本轮实测不符 | 已收 | 记录里的数改成本轮实测的那个 |
| 2026-10-12 第 34 遍 | REVIEW-001 | 新加的 `tree` 读数没兜底：类型声明成数组、运行时可能是 undefined | 已收 | `ui/src/app/use-layout-groups.ts` 里三份清单（控件 / 分组 / 层次图）都经同一个 `listOf` 读成数组：字段缺了当空，界面不炸 |
| 2026-10-12 第 35 遍 | REVIEW-001 | 层次图的「方向」读的 DSL 字段（`flexContainerInfo.flexDirection`）仓内无处佐证、也没有用例覆盖 | 已收 | 注释点名插件那边的同一处读法（`gen-mw-wpf-layout.js` 的 `parent.flex.flexDirection`）；用例夹具改成带 flex 的容器，逐段断言 `flow`（column / row / 自由） |
| 2026-10-12 第 36 遍 | REVIEW-001 | 注释里说的插件字段路径（`parent.flex.flexDirection`）与代码读的（`flexContainerInfo.flexDirection`）看起来不是同一个，仓内无从互证 | 已收 | 注释只陈述本仓能自证的那句，并把字段链点明：插件那份 `gen-mw-wpf-layout.js` 第 106 行 `flex: node.flexContainerInfo || null` 先记成 flex，之后按 `flex.flexDirection` 判主轴 |
| 2026-10-12 第 36 遍 | 非阻断 | 层次图绑在画布上（`canvas` 空则整栏消失）；「有没有层次图」判两次；「算不算控件」三处重复表达；`listOf` 每次渲染重建且 `canvas` 没走同一道兜底 | 已收 | 面板一处判 `hasTree`（画布与树各自独立渲染）；「算不算控件」收成 `ui/src/lib/layout-edit.ts` 的 `isControl`；`listOf` 提到模块级、`canvas` 也按 `?? null` 收口 |
| 2026-10-12 第 36 遍 | 非阻断 | `inspect` 无条件构造层次图，而待确认队列 / 自动补输入那两条路不读它 | 独立一轮 | 加一个「要不要带层次图」的开关并让那两条路关掉它；本次不动（它只是每页多算一遍，没有行为影响） |
| 2026-10-12 第 37 遍 | REVIEW-001 | 复核台账第 33 遍自己写死的前端用例数与验收记录 / 实测对不上 | 已收 | 台账那行改成不写死数字（「改成本轮实测的那个」）—— 数只有验收记录一处给 |
| 2026-10-12 第 37 遍 | REVIEW-002 | 层次图行标签还在用 `numberOf(...) > 0` 判「算不算控件」 | 已收 | 改用 `isControl`（那个谓词只有这一处）；号仍由 `numberOf` 现算 |
| 2026-10-12 第 38 遍 | REVIEW-001 | 「有没有层次图」在面板（`hasTree`）与树组件（`nodes.length === 0` 早退）里各判一次 | 已收 | 只留面板那一处（摆不摆第二条列、挂不挂这块都由它定）；组件里的早退删掉 |
| 2026-10-12 第 38 遍 | REVIEW-002 | 「算不算控件」在同模块里仍有第二份（`labelOf` 自己 `controls.find`） | 已收 | 加 `controlOf`（找那一条只有这一处）：`isControl` / `numberOf` / `textOf` / `labelOf` 都从它走 |
| 2026-10-12 第 39 遍 | REVIEW-001 | 控件 value 仍有两处实现（`textOf` 与 `labelOf` 各 trim 一遍），注释却写「只有这一处取」 | 已收 | 取 value 收成 `valueOf(control)`：`textOf` 按 ref 找那一条再调它，`labelOf` 直接调它 |
| 2026-10-12 第 40 遍 | REVIEW-001 | 台账第 36 遍的「已收」写的是字段链，而注释实际仍写 `parent.flex.flexDirection`（那次补丁没落地） | 已收 | 注释按台账那句落地（字段链 + 仓内路径 `plugins/mastergo-wpf-transcoder/<版本>/…/gen-mw-wpf-layout.js`）；台账那行也与之对齐 |
| 2026-10-12 第 40 遍 | 非阻断 | `numberOf` 一次调用里扫两遍（`controlOf` + `indexOf`）；画布「要不要描」一次渲染算两遍 | 已收 | `numberOf` 回到一遍 `findIndex`；画布把 `on` 算一次、属性与类名共用 |
| 2026-10-12 第 41 遍 | REVIEW-001 | 布局树的控件行缺 React key（列表渲染会按位置复用节点） | 已收 | 那一行由 `line()` 统一产出并带上 `key={lineKey}` |
| 2026-10-12 第 41 遍 | REVIEW-002 | 重构后 `isControl` 成了无人引用的导出 | 已收 | 删掉（找那一条控件的判据只剩 `controlOf`） |

