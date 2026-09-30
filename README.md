# mastergo-transcoder-gui

MasterGo 设计稿转 MTSLG IOContorl / MW WPF 的本地客户端。

前端 React + Vite + shadcn/ui，后端 Node 内置 `http`，两者通过 HTTP 通信。后端唯一的运行时依赖是 `openai`（模型客户端，零传递依赖）。

## 跑起来

```
npm install        # 首次：后端依赖
双击 start.cmd
```

`start.cmd` 调 `launch.js`：先读安装根的 `current.json`，指向 `versions/<版本>/` 就跑那一份，没有指针就跑安装根这一份。

生产形态：前端已构建成 `public/` 下的静态产物，`server.js` 直接提供。默认监听 `127.0.0.1:8787` 并打开浏览器。

```
node server.js --port 9000 --no-open
node server.js --project <工程目录>            # 从工程的 DSL 快照与登记表自动发现页面帧（离线优先）
node server.js --snapshot <dsl.snapshot.json>  # 完全离线：只用一份快照
node server.js --plugin <插件目录>             # 显式指定插件根
node server.js --token mg_xxx                  # 缺省取 env MASTERGO_MCP_TOKEN，再取 ~/.codex/config.toml
```

## 开发

```
npm install                    # 首次：后端依赖
npm --prefix ui install        # 首次：前端依赖
npm run api                    # 起后端（8787，不打开浏览器）
npm run dev:ui                 # 另开一个窗口：Vite dev server（5173），/api 代理到 8787
npm run build:ui               # 构建前端 → public/
```

## 目录

```
ui/            前端源码（shadcn CLI 生成 components/ui/，源码入库）
public/        前端构建产物（vite build --outDir ../public），不手工编辑
launch.js      启动入口：按 current.json 选版本，再拉起那一份的 server.js
server.js      入口：命令行、装配、监听
scripts/       发布工具（不进运行树）
lib/           后端实现（见下）
```

```
lib/http.js         JSON / 请求体 / 静态文件
lib/routes.js       路由表与分发
lib/plugin-root.js  插件定位
lib/plugin.js       插件信息与步骤契约
lib/resolve.js      控件查询
lib/node-controls.js 控件查询引擎（客户端编排，ID 与控件代码取插件的实现）
lib/xml-chunk.js    从整页 XML 里取单个控件片段
lib/run.js          流水线运行管理（进度、日志、失败契约）
lib/board.js        看板：任务的唯一登记（工作目录、并发、AI 补输入、自动合并）
lib/pending.js      待确认清单的读写
lib/artifacts.js    产物台账（读插件运行登记表的 outputs，供「已完成」看板用）
lib/settings.js     用户设置与模型凭据
lib/dpapi.ps1       凭据加解密（PowerShell + Windows DPAPI）
lib/ai.js           模型调用（只出候选，从不写盘）
lib/app-manifest.js 运行树清单（哪些文件、每个的 sha256；发布与更新共用这一份算法）
lib/bundle-store.js 内容寻址库：blobs/ 与 versions/<版本>/ 的落盘、校验、指针
lib/download.js     带重试与超时的取件
lib/proxy.js        出网代理：环境里没有就用 Windows 系统设置补上
lib/update.js       差分更新：拉清单 → 只下变了的 → 落版本目录 → 切指针
lib/launch.js       读 current.json，判断那一份能不能跑
```

## 模型凭据

在「设置」页填厂商 / base_url / 模型名 / API key。key 用 Windows DPAPI（当前用户）加密后存在安装目录的 `credentials`，不写进任何产物、不进日志。

厂商表只列**核实过**的默认值（当前只有 DeepSeek，取自 `~/.codex/config.toml` 的 `model_providers.deepseek`）；其余厂商走「自定义」，填 OpenAI 兼容的 base_url。

## 口径来自插件，本仓库只做编排

控件 ID、映射命中、控件 XML、整页流水线全部由 `mastergo-wpf-transcoder` 插件内的脚本产出，与 Codex / Claude Code 走的是同一份实现。本仓库只负责界面、编排与转发：查询引擎 `lib/node-controls.js` 逐个子进程调用插件的取数、固化快照、mapping、控件代码发射脚本，ID 直接 `require` 插件的 `lib/page-node-id.js`。

插件根的查找顺序：

1. `--plugin <目录>`
2. 环境变量 `MASTERGO_PLUGIN_ROOT`
3. `<CODEX_HOME>/plugins/{cache,marketplaces}` 下的同名插件（有版本目录时取最高版本）
4. `~/.claude/plugins/{cache,marketplaces}` 下的同名插件（同上）

四项都没命中时**直接失败并报告已查找的路径**，不回退到自带副本。

插件内需要：

- `skills/mastergo-to-wpf/scripts/core/call-mastergo-mcp.js` —— 取 getDsl（查询与流水线共用）
- `skills/mastergo-to-wpf/scripts/core/mastergo-dsl-pipeline.ps1` —— 固化 DSL 快照（查询用 `-Action Capture`）
- `skills/mastergo-to-wpf/scripts/core/resolve-mastergo-visibility.js` —— 显隐事实
- `skills/mastergo-to-wpf/scripts/adapters/mtslg-iocontrol/gen-mtslg-mapping-from-dsl.js` —— 推导 mapping
- `skills/mastergo-to-wpf/scripts/adapters/mtslg-iocontrol/gen-iocontrol-xml.js` —— 发射控件代码
- `skills/mastergo-to-wpf/scripts/lib/page-node-id.js` —— 页面节点 ID 公式
- `skills/mastergo-to-wpf/scripts/entry/run-all.ps1` —— 整页流水线入口，界面按它 `-List` 返回的步骤契约渲染

## 任务与看板

任务只有一套登记：`lib/board.js`。流水线页的「加入看板并开始」就是新建一个看板任务并启动它，
看板行的「详情」跳到 `#pipeline?task=<任务 id>`。每个任务有自己的工作目录（复制主工程 → 跑流水线 →
合并回主工程），并发上限按本机逻辑核数给；停在语义判断点等输入、AI 补输入、冲突后停下都由看板管。
运行本身（步骤、日志、断点续跑）仍在 `lib/run.js`，看板与流水线详情读的是同一份运行状态。

同一页面重复跑：合并就是覆盖写入主工程，工程里任何时刻只有一份；看板保留历史记录，后合并的那一单标「生效中」，
更早的标「已被覆盖」并按「只看生效」藏起来（开关可随时放出来看）。

界面功能点每次改完的实点结论记在 `docs/ui-verification.md`。

## 程序更新

版本线只有客户端自己这一条，远端是 GitHub Releases（公开仓库，不需要自建服务端）。

```
npm run publish:update                      # 产物化到 dist/update：manifest.json + files/<sha256>
node scripts/publish.js --upload            # 传成 GitHub Release（gh 需已登录）
node scripts/publish.js --min-client 0.2.0  # 声明这版要求外壳至少 v0.2.0
node scripts/publish.js --no-fresh-run      # 声明这版不要求新开一次运行
```

发布的另一条路是打 tag：先把 `package.json` 版本号改好并提交，再推 `v<版本>` tag，CI 的 `release` 作业会用同一个
`scripts/publish.js --upload` 传资产。两条路的门槛一样：tag 与 `package.json` 版本号必须一致，且 `public/` 必须是当前源码构建出来的那一份。
客户端读的是 `releases/latest/download/manifest.json`，所以清单永远最后传 —— 清单先到而文件没到，客户端会下到 404。

清单是 `{version, files: {路径: sha256}, releasedAt, minClientVersion, freshRunRequired}`，版本号只有一个来源：`package.json`。
文件按内容哈希命名，改一个文件只传/只下那一个：客户端先把本地同哈希的文件放进内容库，缺的才下载。

出网代理：Node 的 `fetch` 只认环境变量，不认 Windows「Internet 选项」，所以启动时 `lib/proxy.js` 会先看环境里有没有代理，
没有就用系统里配的补上 `HTTP_PROXY / HTTPS_PROXY / NO_PROXY`，再让 `fetch` 按它走；两处都没有就是直连。

界面上的四个动作对应四个接口：

| 接口 | 作用 |
| --- | --- |
| `GET /api/update/status` | 不联网，只读本地状态与上一次检查结果；四态 `up_to_date / update_available / download_ready / error` |
| `POST /api/update/check` | 拉远端清单并按 sha256 逐文件差分，结果缓存到 `update-cache/manifest.json`（离线也能显示「有新版 / 要换几个文件」） |
| `POST /api/update/download` | 后台下载缺失内容并拼出 `versions/<版本>/`，进度在 `status().task` 里 |
| `POST /api/update/apply` · `rollback` | 只写安装根的 `current.json` 指针，不抽走正在跑的目录，所以切完要重启客户端才生效 |

有流水线或看板任务在跑时，`apply` 与 `rollback` 一律拒绝（切版本会换掉正在跑的那份脚本）。

能切的只有「坏了也不影响核心流程」的东西：

| 组件 | 策略 | 能否切换 |
| --- | --- | --- |
| 程序本身 | 差分下载 → `versions/` 并存 → 指针切 | 能，含回退 |
| 配置 / 映射层 | 走插件版本，不在这条线上 | 不适用 |
| Node / PowerShell 7 | 在关键路径上，坏了整个客户端起不来 | 不参与切换 |

用户状态（`local.json`、`credentials`、`board.json`、`work/`）永远在安装根，不随版本目录走。

## 依赖

- Node.js（跑后端与构建前端）
- `mastergo-wpf-transcoder` 插件
- `pwsh`（PowerShell 7；5.1 的 GBK 编码会破坏中文）
