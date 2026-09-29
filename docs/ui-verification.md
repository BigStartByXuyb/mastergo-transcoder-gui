# 界面验收记录

每完成一个任务，除单元测试外，还要在真实界面上把这次涉及的功能点一遍，结论记在这里。按时间倒序。

## 怎么点

```
npm run api                                                      # 后端在 8787
npx --yes --package @playwright/cli playwright-cli open "http://127.0.0.1:8787/#board"
npx --yes --package @playwright/cli playwright-cli snapshot       # 取 ref
npx --yes --package @playwright/cli playwright-cli click <ref>
```

两条纪律：

1. ref 只在当次 snapshot 内有效。点按钮后列表会重渲染，旧 ref 会指到别的元素 —— 改状态的操作一次 snapshot 配一次 click。
2. `goto "#另一页"` 只是 hash 变化，浏览器不会重新拉 index.html。前端重新构建后必须 `reload`，否则点到的是上一份构建。

## 2026-09-30 写盘白名单：可写范围只认这一次的工程目录

### 改了什么

- `lib/codex.js`：常量 `WRITABLE_NOTE` 换成 `writableNote(root)`，把可写范围逐字写进提示词；新增 `writeScope()`，
  只放行「绝对路径、真实存在、确实是目录、不是盘根、不是客户端自己的安装目录（`MASTERGO_HOME`／程序所在目录）」；
  `samePath()` 按解析后的绝对路径比对（Windows 大小写不敏感）。
- `execArgs()` 加两道门：开了写盘而目录不合法 → `WRITE_SCOPE`；目录合法但这一次没确认、或确认的不是同一个目录 → `WRITE_CONFIRM`。
- `lib/routes.js`：`/api/agent/chat` 把 `projectRoot` 与 `writeConfirm` 一并交给 `execArgs`，写盘要「设置里开 + 这次勾 + 这次确认目录」三处都同意。
- 对话页：写盘打开后显示范围卡片（逐字列出这次可写的目录）与 `#chat-write-confirm`；没确认时发送键禁用；改工程目录会清掉上一次的确认。
- `tests/codex.test.js`：补 8 条 —— 合法组合放行且范围句含该目录、只读后缀、以及 6 条拒绝（空目录／相对路径／盘根／客户端安装目录／不存在／没确认）。

### 点过的东西

先在设置里把写盘开关打开（`POST /api/settings`），验完改回关；服务在 8787。

| 页面／入口 | 操作 | 观察到 | 结论 |
| --- | --- | --- | --- |
| 对话页 | 写盘开关关着时打开 `#chat` | 没有确认卡片；发送键只看「要问什么」 | 通过 |
| 对话页 | 设置里写盘关着打开 `#chat` | `#chat-write` 存在但 `disabled`，旁边写「（先在设置里开写盘开关）」 | 通过 |
| 对话页 | 填工程目录 `D:\ttt`，点开 `#chat-write` | 出现范围卡片「写盘只落在这一份工程目录之内，别处一律不动：D:\ttt」；`#chat-write-confirm` 未勾，发送键禁用 | 通过 |
| 对话页 | 点 `#chat-write-confirm` | 复选框 `checked`，发送键解禁 | 通过 |
| 对话页 | 把工程目录改成 `D:\ttt2` | 确认自动退回未勾、发送键再次禁用、卡片里的路径变成 `D:\ttt2` | 通过 |
| 接口 | `POST /api/agent/chat`，`projectRoot=D:\ttt` + `writeConfirm=D:\ttt2` | `WRITE_CONFIRM`「这次没有确认可写范围」 | 通过 |
| 接口 | 同上但不带 `projectRoot` | `WRITE_SCOPE`「这次不能开写盘：没给工程目录」 | 通过 |
| 接口 | `projectRoot=D:\` | `WRITE_SCOPE`「这次不能开写盘：工程目录不能是盘根」 | 通过 |
| 接口 | 合法目录 + 确认同一目录 | 放行，codex 真跑完一轮并回话 | 通过（不挡正常用法） |

### 没点的

- 没在设置页里把写盘开关关掉再点一次：设置项的开关形态这轮没动，改设置走的是接口。
- 客户端安装目录（`MASTERGO_HOME`）与相对路径只在单测和接口里验过，没在界面上造这两种输入。
- 插件缓存目录（`~/.codex/plugins`）不在拦截范围：填它并确认后后端放行。这里只记录，判据没改。

### 自动化门禁

| 命令 | 结果 |
| --- | --- |
| `npm test`（仓库根） | 通过 29/29 |
| `npm run test:coverage`（仓库根，`lib/**`） | 通过，all files 96.86 / 82.89 / 96.39（门禁 90/75/90） |
| `npx tsc -b`（`ui\`） | exit 0 |
| `npm --prefix ui run test:coverage` | 通过，27 文件 / 153 用例；all files 99.29 / 91.63 / 100 / 99.29 |
| `npm run lint --prefix ui` | 0 error（只剩既存的 hooks warning） |
| `npm run build:ui` | 通过，`index-DD0ojcQN.js` 530.53 kB |
| `node <cicd>/check-app-structure.mjs --root .` | PASS（硬编码路径 / 孤儿导出 / 分层 / CI 钉死 均 0 条） |

## 2026-09-30 「只看生效」铺到区域详情页 + 任务行宽高固定

### 改了什么

- 抽 `ui/src/app/effective-toggle.tsx`：「只看生效」开关只留一处实现，看板与区域详情共用；藏起几条由调用方数好传进来。
- 区域详情页（`#area?key=<工程>|<区域>`）补上同一个开关 `#area-only-effective`，默认「只看生效」：同一页面只显示本页最后一次合并成功的那一单，
  更早的同类任务标「已被覆盖」并默认藏起，关掉开关才展开。判据与看板共用 `ui/src/lib/board-effective.ts` 的 `coverageOf`
  （页面身份 = 工程 + Ui 前缀 + 页面名 + 模式；只比 `merged`，取 `merge.at` 最大的一条，界面不自己按 `createdAt` 猜）。
- 区域任务行由 `flex-wrap` 改成固定栅格 `grid-cols-[6.5rem_minmax(0,1fr)_4.5rem_4.5rem_auto]`：页面名再长只在自己那一格换行，不撑宽整行。
  看板表格本就是 `table-fixed` + 百分比列宽，这轮只复测，没改动。
- `ui/vitest.config.ts` 覆盖率口径纳入 `src/app/effective-toggle.tsx`（与另外两个共用展示组件同口径）。
- 清掉仓库根 7 张遗留截图（未跟踪文件，不入版本库）。

### 点过的东西

服务在 8787，`/api/health` 指向插件 `1.0.369`；看板数据是 `D:\ttt` 工程（F4 区域 9 条任务）。

| 页面 | 操作 | 观察到 | 结论 |
| --- | --- | --- | --- |
| 看板 | 打开 `#board` 读默认态 | 3 行；开关标签「只看生效（已藏起 6 条被覆盖的）」 | 通过 |
| 看板 | 量表格 | 表宽 `910 == 容器 910`；列宽 `118/137/64/164/291/137`；`document.scrollWidth 1280 == 视口 1280` | 通过 |
| 侧边栏 | 点「F4 8」 | 跳到 `#area?key=D%3A%5Cttt%7CF4`，页面上出现 `#area-only-effective` | 通过 |
| 区域详情 | 读默认态 | 2 行（1「合并冲突」+ 1「已合并／生效中」）；标签「只看生效（已藏起 6 条被覆盖的）」 | 通过 |
| 区域详情 | 量任务行 | 行宽 `912`，五格 `104/566/72/72/66`；`document.scrollWidth 1280 == 视口 1280` | 通过 |
| 区域详情 | 点掉「只看生效」 | 8 行：1「生效中」+ 6「已被覆盖」+ 1「合并冲突」；标签只剩「只看生效」；行宽一律 `912` | 通过（重新生成只留最新那份生效） |
| 区域详情 | 把首行页面名换成 12 遍重复长串 | 行宽仍 `912`、五格宽度不变、该格 `scrollWidth == 566`（文本自己在格内换行）、整页无横向滚动 | 通过 |
| 区域详情 | 点「详情」 | 跳到 `#pipeline?task=e5751190-…&key=…`，12 步里带「人/AI 语义输入」标记的步骤照常显示 | 通过 |

### 没点的

- 没真跑一次完整流水线：这轮动的是呈现与开关，转码链路没碰。
- 「复制区域模板并新建任务」「清空这一区域的任务」「重新合并」这轮没重复点，只看了合并冲突那一行的呈现（没裁决）。
- 没在 1280 以外的宽度量过。

### 自动化门禁

| 命令 | 结果 |
| --- | --- |
| `npm test`（仓库根） | 通过 29/29 |
| `npm run test:coverage`（仓库根，`lib/**`） | 通过，all files 96.84 / 82.73 / 96.37（门禁 90/75/90） |
| `npx tsc -b`（`ui\`） | exit 0 |
| `npm --prefix ui run test:coverage` | 通过，27 文件 / 153 用例；all files 99.29 / 91.63 / 100 / 99.29 |
| `npm run lint --prefix ui` | 通过（0 error，只剩既有的 hooks warning） |
| `npm run build:ui` | 通过，产物 `index-D0Z3BtpE.js` 524.95 kB |
| `node <cicd>/check-app-structure.mjs --root .` | PASS：hardcoded-paths / orphan-exports / layering / ci-pin 各 0 条 |

## 2026-09-30 身份判定改判据：只认「这一页登记过 + 页名没变」

### 改了什么

- `lib/identity.js`：自动沿用的唯一依据改成「同一页帧（layerId）在这份工程里登记过、且设计页名没变」。
  原来按「同一设计文件里恰好一个区域」判，可一个文件里本来就有好几页分属 F1／F4，会把别的页的区域当这一页的先例。
  返回的 `ambiguous: boolean` 换成 `blocked: string`：判不了就把「人要做什么」整句交给界面，文案只有后端这一份。
- 修一个死路：手填 UI 区域 + 英文设计页名时，`lib/routes.js` 在 handler 里把候选按区域过滤，却没让 `candidatesFor`
  拿这个区域去拼 Target —— 拼出来的候选被自己全滤掉，界面变空且没有任何按钮可点。改 `candidatesFor` 接 `explicitUi` 入参。
- 修一个真 bug：沿用登记过的页会把登记里的设计页名冲掉。`writeRegistryEntry` 是整条替换，而沿用时候选带不出页名、
  页名框通常又是空的，写回就变成空页名 —— 下一次改名守卫就再也提醒不了。改：登记候选带回 `designPageName`，`apply` 兜底用它。
- 修一个绕过：改名守卫被人手填的区域压过去了（`explicitUi` 分支清空 `blocked`，把 `renamed` 吃掉）。改：`renamed` 优先于 `explicitUi`。
- 改一处文案与真实行为不符：自动化层级「自动」＋模型可用时，未登记过的页会由模型按设计页名给名**直接采用并写进登记表**，
  提示却写「没登记过会停下来要你点一次」。实测确认后改成「没登记过由模型按设计页名给名直接采用，给不出才停下来要你点一次」。

### 点过的东西

沙盒工程 `D:\ui-verify-identity`（临时目录，不在仓库里）。登记表用 SHA-256 前后对比来判断「有没有写盘」。

| 页面 | 操作 | 观察到 | 结论 |
| --- | --- | --- | --- |
| 新建任务 | 填沙盒 + 链接 `357:269592` + 页名「停止微调」+ UI `F1`，点「自动补 Target / 区域」 | 主区给出整句：「登记表里这一页叫「StopAdjust」，设计稿现在叫「停止微调」（登记的是 Target F1StopAdjust）：改了名就不能静默沿用旧 Target…」，另有「启动失败」提示 | 通过 |
| 新建任务 | 同上一步，查登记表 | hash 前后都是 `3BAA1CCA…C075`，一个字节没动 | 通过（改名守卫真的拦住了写盘） |
| 命令行 | 把沙盒登记表重置成 2 条（去掉 `F1StopAdjust`），hash 变 `33F6DC2A…B0698` | —— | —— |
| 新建任务 | 页名 `StopAdjust` + UI `F1`，点「自动补」 | `#run-target` 回填 `F1StopAdjust`，无阻塞文案 | 通过（首次写入） |
| 新建任务 | 查登记表 | hash `33F6DC2A…B0698` → `A3864B86…879000`，新条目带 `fileId 181586559903927 / layerId 357:269592 / designPageName StopAdjust` | 通过 |
| 新建任务 | 清空页名 / UI / Target，点「自动补」 | `#run-ui` 回填 `F1`、`#run-target` 回填 `F1StopAdjust`，页面无「改了名」文案 | 通过（自动沿用） |
| 新建任务 | 查登记表 | hash 仍 `A3864B86…879000`，条目里 `designPageName` 仍是 `StopAdjust`（没被冲成空） | 通过（修掉的那个 bug） |
| 新建任务 | 换未登记页帧 `357:999999` + UI `F1` + 中文页名「新页面」，点「自动补」 | 模型给出 `F1NewPage` 并**直接写入**登记表（新增第 4 条，`designPageName 新页面`） | 通过（这就是上面那条文案要改的原因） |
| 新建任务 | 改文案后重新构建并 `reload` | 提示变成「当前自动化层级：自动（这一页登记过就自动沿用；没登记过由模型按设计页名给名直接采用，给不出才停下来要你点一次）」 | 通过 |
| 看板 | 1280 宽打开 `#board` | 表格宽 `910 == 容器 910`，`document.scrollWidth 1280 == 窗口 1280`，无横向溢出 | 通过 |
| 看板 | 量每个长内容单元格 | 工作目录列 `-webkit-line-clamp: 3`（行高 32px / 单行 16px）、冲突说明列 `clamp: 2`；都带 `title` 全文；列宽固定 106 / 148 / 275 / 257 px | 通过（中间再长也不撑宽表格） |
| 看板 | 读默认态 | 3 行 + 开关标签「只看生效（已藏起 6 条被覆盖的）」 | 通过 |
| 看板 | 点掉「只看生效」 | 9 行、标签只剩「只看生效」；同时可见 2 条「生效中」+ 6 条「已被覆盖」+ 1 条「合并冲突」 | 通过（同一页重新生成只留最新一份生效，旧的标「已被覆盖」） |
| 任意页 | 量侧边栏 | `aside 288px` + `main 992px` = 1280，整页宽度不随内容变 | 通过 |

### 没点的

- 没真跑一次完整流水线：这轮动的是身份判定与看板呈现，转码链路本身没碰。
- 「从链接取设计页名」「合并冲突逐文件裁决」这轮没重复点，上一轮已验过。
- 没点「只看生效」以外的看板工具条按钮（启动全部 / 合并全部 / 清掉已结束）。

### 自动化门禁

| 命令 | 结果 |
| --- | --- |
| `npm test` | 通过 29/29 |
| `npm run test:coverage` | 通过，lines 96.84 / branch 82.73 / funcs 96.37（门禁 90/75/90；`identity.js` 100 / 86.17 / 100） |
| `npm --prefix ui run test:coverage` | 通过，stmts 99.28 / branch 91.57 / funcs 100（`identity-pick.ts` 满分） |
| `npm --prefix ui run lint` | 通过（0 error，只剩既有的 hooks warning） |
| `npx tsc -b`（`ui\`） | exit 0 |
| `npm run build:ui` | 通过 |
| `check-app-structure.mjs --root .` | PASS：hardcoded-paths / orphan-exports / layering / ci-pin 各 0 条 |

## 2026-09-30 运行时钉死：Node / PowerShell 7 自带，下载按字节出进度

### 改了什么

- `lib/runtime.js`（新增）：Node.js `24.21.0`、PowerShell 7 `7.6.6` 各钉一版，装到安装根 `runtime\`；
  下载 → 解压 → 自检三步，坏包按清单哈希拦下；claude 只检测，不代下载。这两份在关键路径上，不提供版本切换。
- `lib/download.js`：`fetchBuffer` 支持 `onProgress(received, size)`，读流式 body 分段回调；
  带 `content-encoding` 时长度按 0 报（那长度是压缩前的，拿来算进度是错的）。
- `lib/plugin.js`、`lib/run.js`：子进程一律走 `childEnv()`，PATH 里优先自带运行时。
- `lib/routes.js`、`server.js`：`GET /api/runtime/status`、`POST /api/runtime/download`。
- `start.cmd`：优先用 `runtime\node\node.exe`。
- `ui/src/lib/runtime-state.ts`、`ui/src/app/runtime-card.tsx`：设置页的运行时卡片，三行各自说清现在用的是哪份、缺不缺、给不给下载入口。
- 修掉一个真 bug：`childEnv()` 原来写 `env.PATH`，Windows 上变量真名是 `Path`，等于造出两个同名变量；改成大小写不敏感地改原来那条。
- 进度口径：任务形状从 `done/total`（三步计数，大包几百兆也是 0/3 一动不动）换成 `received/size`；
  服务器没给 Content-Length 就退回不确定态，不编一个假百分比。

### 点过的东西

| 页面 | 操作 | 观察到 | 结论 |
| --- | --- | --- | --- |
| 设置 | 1280 宽打开 `#settings` | 徽标「自带 2 份 / 用系统的 0 份」；Node `钉 v24.21.0` + `自带 v24.21.0`；pwsh `钉 v7.6.6` + `自带 v7.6.6`；Claude `只检测` + `系统 v2.1.278`，无按钮 | 通过 |
| 设置 | 把 `runtime\node` 改名移走再刷新 | 徽标变「自带 1 份 / 用系统的 1 份」+「现在能跑；下成自带的就不用管本机装没装。」；Node 行变 `系统 v24.14.0` + `下载 v24.21.0` | 通过 |
| 设置 | 点「下载 v24.21.0」，`MutationObserver` 记进度条与文案 | 起手 `正在下载 Node.js…`（总长度还没到）；随后 `正在下载 Node.js（32.9 MB / 35.9 MB）`；进度条 transform 依次 -100% → -99 → -98 → -97 → -94 → -92 → -89 → -85 → -80 → -76 → -70 → -65 → -60 → -55 → -50 → -44 → -38 → -32 → -26 → -17 → -8（0% → 92%，真的在走） | 通过（本轮要修的就是这个） |
| 设置 | 等下载落盘 | 回到 `自带 v24.21.0`，徽标回「自带 2 份 / 用系统的 0 份」，进度条与说明行消失 | 通过 |
| 命令行 | `runtime\node\node.exe --version` / `runtime\pwsh\pwsh.exe -NoProfile -Command $PSVersionTable.PSVersion` | `v24.21.0` / `7.6.6`，与钉死版本一致 | 通过 |
| 看板 | 1280 宽打开 `#board` | 表格 `910 == 容器 910`，文档宽 `== 窗口宽 1280`，无横向溢出 | 通过 |
| 映射表 | 打开 `#mapping` | 25 行数据渲染；页脚显示来源 `插件 v1.0.369`、模板族 10 / 底部栏变体 17 / 必写字段表 15 | 通过 |
| 新建任务 | 打开 `#pipeline` | `共 12 步` 契约与表单（链接、工程目录、Target、路线、UI 区域、停在某一步）都渲染 | 通过 |

### 没点的

- Claude 那一行本来就没有按钮（只检测），没点。
- 「重下」路径（自带那份坏了）：要先故意弄坏 `runtime\node`，跟上面「移走再下」共用同一条下载与解压链路，没重复跑。
- 窄窗（<768）侧边栏仍固定 256px，是已知项，这轮没管。

### 自动化门禁

| 命令 | 结果 |
| --- | --- |
| `npm run test:coverage` | 通过，lines 96.81 / branch 82.51 / funcs 96.37（门禁 90/75/90） |
| `npm --prefix ui run test:coverage` | 通过，stmts 99.28 / branch 91.47 / funcs 100（`runtime-state.ts` 满分） |
| `npm --prefix ui run lint` | 通过（0 error，只剩既有的 hooks warning） |
| `npx tsc -b` | 通过 |
| `npm run build:ui` | 通过 |
| `node <cicd>/check-app-structure.mjs --root .` | PASS（硬编码路径 / 孤儿导出 / 分层 / CI 钉死 均 0 条） |

## 2026-09-30 对话页：Codex 自动/对话模式端到端（含「停下」真杀进程）

### 改了什么

- `lib/routes.js`：`/api/agent/chat` 的断开监听从 `request.on("close")` 挪到 `response.on("close")` 且要求
  `!response.writableEnded`。请求体的 `close` 在请求读完时就发（实测隔 7ms），拿它当「客户端断开」永远杀不掉 codex 子进程；
  真断开只体现在响应流上。
- `ui/src/lib/agent-stream.ts`：这一轮失败只认 `turn.failed`；`item.completed/error` 与顶层 `error`（重试、网络抖动、
  模型元数据缺失）都是浅色提示 —— 跑没跑完交给收尾判定。
- `ui/src/app/chat-page.tsx`：一红就是真没跑完 —— 传输失败、`turn.failed`、退出码非 0、退出码 0 却没收到
  `turn.completed`（人点「停下」不算）才出红卡；引擎日志按轮收尾，挂在那一轮末尾。
- `ui/src/app/chat-transcript.tsx`：日志从「全页一份、每次发送被重置」改成「一轮一条」，默认收着，收尾不干净才自动铺开。

### 点过的东西

| 页面 | 操作 | 观察到 | 结论 |
| --- | --- | --- | --- |
| 对话 | 发「只回答四个字：链路正常」 | 会话徽标 `对话 01a0eea5`；正文「链路正常」+「一轮结束」；`Model metadata ... not found` 是浅色一行；红卡 0；「引擎日志（1 行）」默认收着 | 通过 |
| 对话 | 同一页面接着问「再回答三个字：收到了」 | 徽标仍是 `对话 01a0eea5`（thread 复用）；两轮日志各留一条（`引擎日志（2 行）`、`引擎日志（1 行）`），都是收着 | 通过（修掉「上一轮日志被清掉」） |
| 对话 | 点第一轮的「引擎日志（2 行）」 | 展开出当轮 stderr（`Reading additional input from stdin...` + skill 加载失败），时间戳 `19:30:34` 对应第一轮 | 通过 |
| 对话 | Base URL 换死端口 `http://127.0.0.1:9/v1` 再发 | 重试消息 `Reconnecting... waiting for network` 是浅色一行；红卡 0（不再提前报红） | 通过 |
| 对话 | 点「停下」 | 5 秒内 `codex.exe` 里 parent `28000` 的子进程从 1 个变 0 个，`pid 48024` 也查不到；界面不再有「停下」；日志挂成收着的一条；红卡 0（自己停的不算失败） | 通过（本轮真 bug 修复） |
| 对话 | Base URL 改回 `https://api.deepseek.com` 再发一轮 | 「收尾正常」+「一轮结束」；红卡 0；日志收着 | 通过 |
| 设置 | 两次读写 Base URL（死端口 → 回 DeepSeek） | `GET /api/settings` 回读一致，`local.json` 恢复 `https://api.deepseek.com` | 通过 |

### 没点的

- 写盘开关（`agent.allowWrite` 是 false，界面上是禁用态）：没开，写操作白名单与二次确认留给要改工程文件的那次。
- Codex 版本列表 / 切换 / 回退：会真下载并改指针，由第 5 块更新器演练覆盖。
- 「停下」之后再在同一个 thread 追问：本次没验证停掉那一轮的半途状态怎么接。

### 自动化门禁

| 命令 | 结果 |
| --- | --- |
| `npm run test:coverage` | 通过，lines 96.56 / branch 81.87 / funcs 96.04（门禁 90/75/90） |
| `npm --prefix ui run test:coverage` | 通过，stmts 99.23 / branch 90.64 / funcs 100 |
| `npm --prefix ui run lint` | 通过（0 error） |
| `npm --prefix ui run build` | 通过 |
| `node <cicd>/check-app-structure.mjs --root .` | PASS（硬编码路径 / 孤儿导出 / 分层 / CI 钉死 均 0 条） |

## 2026-09-30 复核：同页重复合并只留一份 + Layout 语言名 + 看板定宽

### 改了什么

- `lib/plugin-layout.js`：重新注册 Layout 用的清单改从本页 Bundle 审计 `Generated/<Target>.bundle.manifest.json` 的 `inputs` 取
  —— 插件第 10 步喂给 `gen-mtslg-layout.js` 的就是这份，含语言绑定产出的 `MenuItem.langName`。原来取第 8 步
  `Generated/_inputs/<Target>.layout-manifest.json`，那份只有机械推导结果、没有 `langName`，注册进主工程的 `MenuItem` 全是
  `LangName=""`，与插件单独跑不一致。
- `lib/workdir.js`：建工作目录不再跳过 `Generated/`。`Generated/_inputs` 里的命名表/译文/术语是本次运行的输入，不复制会让插件
  退回「待命名」重新猜键名，猜出来的与上一版不同就覆盖掉已确认的产物。
- `lib/merge.js`：`Generated/_work/**` 这类运行临时账在本任务里被插件清掉时，主工程里同步清掉（被人在跑完之后改过的留着不动）。

### 结论

- 反复跑同一页不会留两份：主工程 `D:\ttt` 的 `Resources\Pages\F4TargetTeaching\`、`Generated\runs\F4TargetTeaching\` 各只有一个 ——
  后一次合并是覆盖。界面上靠「生效中 / 已被覆盖」区分：同一（工程 + Ui + Target + 模式）里合并时间最新的是「生效中」，
  其余已合并的是「已被覆盖」，默认藏起来，只在开关标签里报条数。
- Layout 与插件单独跑逐字节一致：`Resources\Layout\Layout.xml` 两侧 sha256 都是 `8047B949…B2FC`，F4 页 10 个 MenuItem 里 9 个带
  `LangName`（`MenuItemUpArrow`、`MenuItemCurrentPosition` …），剩下 1 个在设计稿里本来就是空槽位（`Name=""`）。
- 看板表格宽 = 内容区宽 = 窗口宽减侧边栏，文档横向滚动宽恒等于窗口宽。

### 点过的东西

| 页面 | 操作 | 观察到 | 结论 |
| --- | --- | --- | --- |
| 看板 | 打开 `#board`（1280 宽） | 徽标「正在跑 0 / 待合并 0 / 任务 9」；「只看生效（已藏起 6 条被覆盖的）」默认勾选，表里 3 行（HH/A 生效中、F4/B 冲突、F4/B 生效中） | 通过 |
| 看板 | 量 1280 / 1000 / 860 三档 | `table == box` 均为 910、630、490，`doc == win`，无横向溢出 | 通过 |
| 看板 | 量行高与长文本格 | 普通行 85px；冲突行 897px（4 条待裁决堆叠，是内容高度不是被撑宽）；「工作目录」clamp 3 行、「冲突理由」clamp 2 行，都挂 `title` | 通过 |
| 看板 | 关掉「只看生效」 | 9 行 = 2 条「生效中」+ 6 条「已被覆盖」（徽标 `title` 带「覆盖」）+ 1 条「合并冲突」 | 通过 |
| 看板 | 点 `90547f7c` 那行的「详情」 | 跳到 `#pipeline?task=90547f7c-62c6-4922-bbd4-4e12443d5113` | 通过 |
| 流水线详情 | 看 12 步与产物表 | 12/12 全「完成」；第 7、9 步挂「人/AI 语义输入」；产物 10 行，`Resources/Layout/Layout.xml` 哈希 `8047b949bffd…` 与磁盘一致；运行标识 `20260930-030454-dd8916a5` | 通过 |
| 映射表 | 打开 `#mapping` | 模板族 10 / 底部栏变体 17 / 必写字段 15，写入规则与共享类型表都指向插件 1.0.369 | 通过 |
| 映射表 | 搜索框填「底部栏」 | 族表变「没有匹配的族（底部栏变体见下一张卡片）」，布局规则卡只留底部栏那条 | 通过 |
| 待确认 | 打开 `#review` | 「当前没有待确认的页面。」 | 通过 |
| 设置 | 打开 `#settings` | 模型卡（厂商 / 模型名 `deepseek-chat` / Base URL / API key）+「key 已保存（DPAPI 加密）」；Codex 引擎钉 `v0.159.0`、会话目录 `agents\codex\home` | 通过 |
| 主工程 | `Get-ChildItem D:\ttt\Resources\Pages`、`D:\ttt\Generated\runs` | 两个位置各只有一个 `F4TargetTeaching`，没有第二份 | 通过 |

### 没点的

- 「启动全部 / 合并全部 / 清掉已结束」这次没点，逻辑由 `tests/board.test.js` 覆盖。
- 冲突行的「以本任务为准 / 保留主工程」没点：会真写主工程，留给要合并的那次。
- 设置页保存模型表单、切换 Codex 版本没点：会真写 `local.json` 与触发下载。

## 2026-09-30 表格不再被裁 + 设置页模型卡片自动恢复

### 改了什么

- `ui/src/app/board-page.tsx`：任务表列宽从像素改比例。原来 `w-32/w-36/w-16/w-52/w-48` 合计 736px，而像素列宽会把表格的
  min-content 顶到 736px —— 内容区只有 530px 时表格仍按 736px 排，中间「工作目录 / 说明」列被压成 0 宽，实测那行拉到 4417px 高，
  右侧「操作」列被 `overflow-hidden` 裁掉。改为 `w-[13%]/15%/7%/18%/auto/15%`。
- `ui/src/app/review-page.tsx`、`ui/src/app/mapping-page.tsx`、`ui/src/app/done-board.tsx`：同样改成 `table-fixed` + 比例列宽，
  长内容列补 `whitespace-normal`，映射表变体徽标加 `max-w-full` 与 `title`。映射表实测原来第二张表 1128px 挤在 530px 容器里，被裁掉一半。
- `ui/src/app/settings-page.tsx`：模型表单的「读设置失败」从 `failure`（保存失败）分出来成 `probe`，加载挂在 `useHealth` 的 `offline` 上：
  后端断了自己出告警，后端回来自己重读一次。

### 点过的东西

| 页面 | 操作 | 观察到 | 结论 |
| --- | --- | --- | --- |
| 看板 | 打开 `#board`（1280 宽） | 徽标「正在跑 0 / 待合并 0 / 任务 5」；「只看生效（已藏起 2 条被覆盖的）」默认开；表里 2 条「生效中」（HH/A、F4/B）与 1 条「合并冲突」 | 通过 |
| 看板 | 关掉「只看生效」 | 变 5 行：2 条「生效中」、2 条「已被覆盖」（悬停说明「同一页面的后一次合并已经把它覆盖」）、1 条冲突；开关标签回落到不带计数的「只看生效」 | 通过 |
| 看板 | 量宽度 1280 / 900 / 760 | 表格宽 910/910、530/530、390/390，与容器完全相等，文档横向滚动宽等于窗口宽 | 通过 |
| 待确认 | 打开 `#review` 量 1280 / 900 / 700 | 910/910、530/530、330/330（改之前 700 宽时是 375 挤 330） | 通过 |
| 映射表 | 打开 `#mapping` 量 1280 / 900 / 700 | 两张表都 910/910、530/530、330/330（改之前第二张是 1128 挤 530） | 通过 |
| 流水线详情 | `#pipeline?task=372031a0…` 量 1280 / 900 / 700 | 产物表 910/910、530/530、330/330（改之前 700 宽时是 500 挤 330） | 通过 |
| 设置 | 页面开着时杀掉后端进程 | 模型卡片出「出错了 / 连不上本地服务，暂时读不到设置。」；Codex 与程序更新两张卡片各自出「连不上本地服务：Failed to fetch」 | 通过 |
| 设置 | 后端起来后不刷新页面，等一次轮询 | 三处告警全部自动消失，「key 已保存（DPAPI 加密）」与模型名 `deepseek-chat` 都在，Codex 卡片回到「已是最新 v0.159.0。」 | 通过 |

### 没点的

- 「启动全部」「合并全部」「清掉已结束」这次没点：要真跑流水线才动得了任务，逻辑由 `tests/board.test.js` 与
  `ui/src/lib/board-effective.test.ts` 覆盖。
- 冲突面板的「以本任务为准 / 保留主工程」没点：会把主工程写脏，等真有需要再点。

### 发现没改

- 上一轮记的「模型卡片在后端恢复后仍留着告警、要刷新才消失」这次已修，页面不用刷新。
- 窗口窄到 768 以下时侧边栏仍固定 256px，内容区只剩 330px：表格能完整显示，但列很窄、换行变多。没有为此改响应式布局。

## 2026-09-30 Codex 集成（对话 / 引擎版本 / 写盘）

### 改了什么

- `lib/codex.js`：`execArgs` 固定带 `-s danger-full-access`；写盘权限改成提示词前缀 `[只读]` / `[可写]`。
  实测依据：Windows 上 `read-only` 与 `workspace-write` 会把所有 shell 调用都拒掉（连 `Get-Date`、`echo hi`
  都是 `rejected: blocked by policy`，工作目录设在工程内也一样），只有 `danger-full-access` 真能读能跑。
  也就是说 Windows 上做不到「只读但能读」，只读只能是给它的约定。
- `ui/src/app/settings-page.tsx`：Agent 写盘卡片写明这一点，正文与副说明都不再承诺系统级只读。
- `.gitignore`：加 `agents/`（Codex 引擎按需下载的运行文件与隔离会话目录）。
- `tests/codex.test.js`：断言改成「带 danger-full-access」「写盘走提示词前缀」。

### 点过的东西

| 页面 | 操作 | 观察到 | 结论 |
| --- | --- | --- | --- |
| 设置 | 打开 `#settings` | Agent 写盘卡片默认关；Codex 引擎徽标「本机装的 v0.158.0-alpha.2.1 / 没验证过」，正文「远端有 v0.159.0，比现在用的新。」，按钮「检查版本」「下载 v0.159.0」，本机三份都列出来并带完整路径 | 通过 |
| 设置 | 点「下载 v0.159.0」 | 先出「正在下载 1/4（其中新内容 1 个）」，进度 1/4→4/4；完成后徽标变「客户端下载的 v0.159.0 / 自检通过」、正文「已是最新 v0.159.0。」，本机三份的「正在用」标记消失 | 通过 |
| — | 落盘核对 | `agents/codex/versions/0.159.0/` 四个程序齐（codex / code-mode-host / command-runner / windows-sandbox-setup）；`agents/codex/blobs/` 四份按 sha256 命名；`codex.exe --version` 回 `codex-cli 0.159.0`；`known.json` 记 `0.159.0: verified` | 通过 |
| 设置 | 点「用本机那份」 | 徽标回到「本机装的 v0.158.0-alpha.2.1 / 没验证过」，出现「退回 v0.159.0」，下载版那行变「切到这一版」；`agents/codex/current.json` = `{version:"", previous:"0.159.0"}` | 通过 |
| 设置 | 点「退回 v0.159.0」 | 徽标回到「客户端下载的 v0.159.0 / 自检通过」，「退回」按钮消失；指针 = `{version:"0.159.0", previous:""}` | 通过 |
| 设置 | Agent 写盘开关开→关 | 开着时 `local.json` 落 `agent.allowWrite: true`，关回去落 `false`，接口回读一致 | 通过 |
| 对话 | 打开 `#chat` | 工程目录默认 `D:\ttt`；写盘开关禁用并带「（先在设置里开写盘开关）」；没输入时「发送」禁用 | 通过 |
| 对话 | 输入问题后点「发送」（只读） | 徽标从「还没开始」变「Codex v0.159.0（managed）」+「对话 01a0ee62」；回答列出 `docs / Generated / Resources / UI`，和 `D:\ttt` 顶层实际一致 | 通过 |
| 对话 | 设置里的写盘关着时看对话页开关 | 开关禁用；设置里打开后同一个开关可以勾 | 通过 |
| 对话 | 勾上写盘，发「新建 agent-write-check.txt，内容写 ok」 | 记录里出现命令块 `Set-Content -LiteralPath 'D:\ttt\agent-write-check.txt' -Value 'ok'`、`exit 0`、输出 `ok`、助手小结与「一轮结束」；磁盘上文件真的在且内容为 ok | 通过 |
| — | 清场 | 删掉 `D:\ttt\agent-write-check.txt`，写盘开关关回 false | 通过 |
| 设置 | 页面开着时把后端停掉 | Codex 卡片出「读不到 Codex 状态 / 连不上本地服务：Failed to fetch」，程序更新卡片出「读不到更新状态」，页面其余部分不白屏 | 通过 |
| 设置 | 后端起来后等一次轮询 | Codex 卡片回到「客户端下载的 v0.159.0 / 自检通过」，更新卡片回到「已是最新 v0.1.0」 | 通过 |

每轮都会有一条「Codex 报错」提醒 `Model metadata for deepseek-chat not found`：codex 手里没有 DeepSeek 的模型元数据，
这是它的提醒，命令与回答照常跑完 —— 判据是同一轮里命令 `exit 0`、结论正确。

### 没点的

- 程序更新（差分下载 / 切换 / 回退）这次没重跑，下面那条记录仍然有效。
- 「有任务在跑时禁止切版本」没点：要真跑一次流水线才撞得上，拒绝逻辑由 `tests/codex.test.js` 覆盖。
- 对话续跑（`resume`）没点：这一页只问了一轮。

### 发现没改

- 设置页「模型」卡片在后端恢复后仍留着「连不上本地服务」的告警，要刷新页面才消失（这张卡片只在挂载时取一次，
  Codex 与程序更新两张是轮询的）。

## 2026-09-30 程序更新（差分下载 / 切换 / 回退）

### 改了什么

- `lib/app-manifest.js`：运行树清单（`server.js`/`launch.js`/`package.json`/`start.cmd` + `lib`/`public`/`vendor`），发布与更新共用这一份算法。
- `lib/bundle-store.js`：内容寻址库 `blobs/` 与 `versions/<版本>/` 的落盘、校验、指针；本地同哈希的文件直接进内容库，缺的才算要下载。
- `lib/download.js`：取件的重试、超时、退避（4xx 不重试）。
- `lib/update.js`：四态、差分、后台下载、切指针、回退。
- `lib/launch.js` + `launch.js` + `start.cmd`：按 `current.json` 选版本再拉起那一份的 `server.js`。
- `scripts/publish.js`：`manifest.json` + `files/<sha256>` 产物化，可 `--upload` 传成 Release（带 `--min-client` / `--no-fresh-run`）。
- `lib/routes.js`、`server.js`：五个 `/api/update/*` 接口；启动时静默检查一次。
- `ui/src/lib/update-state.ts`、`ui/src/app/update-card.tsx`、设置页：四态文案、版本列表、进度、四个按钮。

### 点过的东西

真发了一版 v0.1.1（临时 Release，`package.json` 之外 47 个文件内容相同），跑完删除。

| 页面 | 操作 | 观察到 | 结论 |
| --- | --- | --- | --- |
| 设置 | 打开 `#settings`（清掉 `update-cache` 后的首次后台检查） | 「程序更新」卡片：徽标「已是最新 v0.1.0」、仓库名 `BigStartByXuyb/mastergo-transcoder-gui`、版本列表一条 `v0.1.0 正在用` | 通过 |
| 设置 | 点「检查更新」 | 徽标变「有新版本 v0.1.1」，正文「运行树 48 个文件，要比对替换 1 个；这版要求新开一次运行。」，出现「下载 v0.1.1」 | 通过 |
| 设置 | 点「下载 v0.1.1」 | 变「v0.1.1 已下载」+「关掉这个窗口再重新双击 start.cmd，就切到 v0.1.1 跑。」；版本列表多一条 `v0.1.1 可切换` | 通过 |
| — | 落盘核对 | `versions/0.1.1/` 48 个文件（含 `public/index.html`）、`package.json` 里是 `0.1.1`；`blobs/` 48 份 —— 47 份由本地同哈希直接入库，只有 `package.json` 真的下载了 | 通过 |
| 设置 | 点「重启后用 v0.1.1」 | 出现「退回 v0.1.0」与「下次启动会跑 v0.1.1；现在这个窗口还是 v0.1.0。」；`current.json` = `{version:0.1.1, previous:0.1.0}` | 通过 |
| — | 真重启（`node launch.js --no-open`） | 打印「版本: v0.1.1（current.json）」「MasterGo 转码客户端 v0.1.1」，引擎路径变成 `versions\0.1.1\lib\node-controls.js`；`/api/health` 返回 `0.1.1` | 通过 |
| 设置 | 重启后点「退回 v0.1.0」 | 提示「下次启动会跑 v0.1.0；现在这个窗口还是 v0.1.1。」，`current.json` = `{version:0.1.0, previous:""}`，「退回」按钮消失（回退只在刚切过之后可用） | 通过 |
| — | 再重启 | 打印「版本: 本地这一份（无指针）」，`/api/health` 回到 `0.1.0` | 通过 |
| 设置 | 页面开着的时候把后端停掉 | 卡片出现「读不到更新状态 / 连不上本地服务：Failed to fetch」，页面其余部分保持上次数据不白屏 | 通过 |
| 设置 | 后端起来后等一次轮询 | 告警消失，徽标回到「已是最新 v0.1.0」 | 通过 |

### 没点的

- 有任务在跑时点切换：会换成真跑一次流水线，留给实际要切版本的那次（拒绝逻辑已由 `tests/update.test.js` 覆盖）。
- 下载中断 / 哈希不匹配：同样只在单测里造（`tests/update.test.js`、`tests/bundle-store.test.js`）。
- 临时 Release 与 tag 已删；本机的 `versions/`、`blobs/`、`update-cache/`、`current.json` 也已清掉，机器回到验证前的状态。

## 2026-09-30 看板「当前生效 / 已被覆盖」与固定列宽

### 改了什么

- `ui/src/lib/board-effective.ts`：同一页面（工程 + Ui + Target + 模式）里，合并时间最新的那条算「生效中」，
  其余已合并的算「已被覆盖」。只比 `state === "merged"` 的任务，冲突中的那条不参与。
- `ui/src/app/board-page.tsx`：状态列加「生效中 / 已被覆盖」徽标；工具条加「只看生效」开关（默认开，
  被覆盖的行默认藏起来，括号里给出藏了几条）；表格改 `table-fixed`，各列定宽；各列改顶对齐
  （冲突行很高时状态 / Target / 模式 / 进度 / 操作不再被垂直居中到行中间）。
- `lib/board.js`：读盘时把冲突项的 `resolvable` 补成布尔，缺字段按「可裁决」算。
- `ui/src/app/mapping-page.tsx`：映射表的搜索覆盖底部栏变体（这些变体在 `layoutRules` 下，不属于任何模板族）。
- `ui/src/app/merge-conflicts.tsx`：冲突面板加「清空选择」（批量选了以后能一键回到 0/4）。
- `README.md`、`docs/ui-verification.md`：记重复跑同一页面的口径与这份验收记录。

### 点过的东西

| 页面 | 操作 | 观察到 | 结论 |
| --- | --- | --- | --- |
| 看板 | 打开 `#board` | 任务 5，「只看生效」默认勾选，标签写「已藏起 2 条被覆盖的」，表里 3 行 | 通过 |
| 看板 | 关掉「只看生效」 | 出现 5 行；F4/B 三行里 `372031a0`(17:11:10) 是「生效中」，`fadb48f8`(15:42:49) 与 `7176f66f`(17:07:53) 是「已被覆盖」；HH/A 单独一条「生效中」 | 通过 |
| 看板 | 再打开「只看生效」 | 回到 3 行，被覆盖的两条带 `title`「同一页面的后一次合并已经把它覆盖，工程里当前不是这一份」 | 通过 |
| 看板 | 量表格宽度 | 表宽 = 容器宽 = 910px，`scrollWidth` = `clientWidth`（横向不溢出）；列宽 128/144/64/208/174/192 | 通过 |
| 看板 | 往「工作目录」格塞一条超长路径 | 表宽仍是 910px；单元格内容宽 158px，换行显示，`clientHeight` 48px 对 `scrollHeight` 128px —— 正好截在 3 行，鼠标悬停有 `title` 全文 | 通过 |
| 看板 | 看冲突行 `e5751190`（4 处冲突） | 状态 / Target / 模式 / 进度 / 操作都在行顶；冲突清单把行拉高也不影响其它列 | 通过 |
| 看板 | 点冲突行的「以本任务为准」 | 计数从「已裁决 0/4」变「1/4」，出现「撤销选择」，`board.json` 落 `Resources/Pages/F4TargetTeaching/F4TargetTeachingIcons.xaml: mine` | 通过 |
| 看板 | 点「撤销选择」 | 回到「0/4」，`board.json` 里 `resolutions` 清空，按钮消失 | 通过 |
| 看板 | 点「全部以本任务为准」 | 计数变 4/4，每行出现「撤销选择」，工具条出现「清空选择」 | 通过 |
| 看板 | 点「清空选择」 | 回到 0/4；0/4 时这个按钮不显示 | 通过 |
| 看板 | 看「不能裁决」的那一条 | 项目级文件产物不合格时不给按钮、只显示原因，不让人拍板 | 通过 |
| 映射表 | 搜索框输入「底部栏」 | 族表显示「没有匹配的族（底部栏变体见下一张卡片）」，底部栏卡片列出变体（如「底部栏/非首页-长方形 · 有 F 键槽位」） | 通过 |
| 映射表 | 搜索框输入「选择框」 | 族表只剩 `selectBoxTemplates`（选择框-40/36/32/28），底部栏卡片隐藏 | 通过 |
| 映射表 | 清空搜索 | 恢复「模板族 10 / 底部栏变体 17 / 必写字段表 15」全量 | 通过 |
| 待确认 | 打开 `#review` | 没有待办时显示「当前没有待确认的页面」+ 手工指定表单 | 通过 |
| 控件 ID 查询 | 打开 `#lookup` | 表单渲染 | 通过 |
| 设置 | 打开 `#settings` | 模型卡片（厂商 DeepSeek / 模型名 deepseek-chat / Base URL /「key 已保存（DPAPI 加密）」）+ 运行环境卡片（插件路径、控件查询引擎、流水线入口、已登记页面帧 2） | 通过 |
| 详情 | 看板行点「详情」 | 跳到 `#pipeline?task=<id>`；12 步进度全列，第 7/9 步标「人/AI 语义输入」 | 通过 |
| 详情 | 看产物区 | 10 个产物带 SHA256 短哈希，另有「产物 10 / 审计件 10 / 备份 7 / 已清理中间件 12」与「本页待办」 | 通过 |

### 没点的

- 「重新合并」会真写主工程（`D:\ttt`），本次界面验收不代跑，留给实际要合并的那次。
- 设置页只看了渲染，没改厂商 / base_url 后保存再回读。

### 自动化门禁

| 命令 | 结果 |
| --- | --- |
| `npm test` | 通过，21 个文件全过 |
| `npm run test:coverage` | 通过，lines 95.77 / branch 79.35 / funcs 95.67（门禁 90/75/90） |
| `npm --prefix ui run test:coverage` | 通过，21 文件 86 用例，stmts 99 / branch 88.47 / funcs 100 |
| `npm run build:ui` | 通过 |
| `node <cicd>/check-app-structure.mjs --root .` | PASS（硬编码路径 / 孤儿导出 / 分层 / CI 钉死 均 0 条） |

