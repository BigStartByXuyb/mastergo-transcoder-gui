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
