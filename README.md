# mastergo-transcoder-gui

MasterGo 设计稿转 MTSLG IOContorl / MW WPF 的本地客户端。

前端 React + Vite + shadcn/ui，后端 Node 内置 `http`，两者通过 HTTP 通信。后端唯一的运行时依赖是 `openai`（模型客户端，零传递依赖）。

## 跑起来

```
npm install        # 首次：后端依赖
双击 mastergo-transcoder.exe（推荐：没装 Node 的机器也能起）或 start.cmd
```

`start.cmd` 调 `launch.js`：先读安装根的 `current.json`，指向 `versions/<版本>/` 就跑那一份，没有指针就跑安装根这一份。
`launch.js` 同时是监督进程 —— 界面里点「切换版本」时，跑着的那一份按约定退出，它按新指针再拉起来。
那个窗口就是服务本身：关掉它服务就停，页面跟着打不开。

生产形态：前端已构建成 `public/` 下的静态产物，`server.js` 直接提供。默认监听 `127.0.0.1:8787` 并打开浏览器。

```
node server.js --port 9000 --no-open
node server.js --project <工程目录>            # 从工程的 DSL 快照与登记表自动发现页面帧（离线优先）
node server.js --snapshot <dsl.snapshot.json>  # 完全离线：只用一份快照
node server.js --plugin <插件目录>             # 显式指定插件根
node server.js --token mg_xxx                  # 覆盖取值链第一级；不传就按后面四级顺序取
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
ui/public/favicon.svg  那只像素小狐狸（浏览器标签图标，与加载动画同一张图）
changelog.json 每个版本改了什么（进运行树）：客户端更新页显示，发布清单与 Release 说明也读它
launch.js      启动入口 + 监督进程：按 current.json 选版本，拉起那一份的 server.js，换版本时自己重起
server.js      入口：命令行、装配、监听
scripts/       发布工具（不进运行树）
lib/           后端实现（见下）
```

```
lib/http.js         JSON / 请求体 / 静态文件
lib/routes.js       路由表与分发
lib/plugin-root.js  插件定位
lib/plugin.js       插件信息与步骤契约
lib/plugin-update.js 插件那一半：按发布件里的插件清单装一份到客户端自带的位置
lib/resolve.js      控件查询
lib/mcp-token.js    MasterGo 取数凭证的取值链（命令行 / 环境变量 / 本机保存 / config.toml）
lib/node-controls.js 控件查询引擎（客户端编排，ID 与控件代码取插件的实现）
lib/xml-chunk.js    从整页 XML 里取单个控件片段
lib/run.js          流水线运行管理（进度、日志、失败契约）
lib/board.js        看板：任务的唯一登记（工作目录、并发、AI 补输入、自动合并）
lib/pending.js      待确认清单的读写
lib/chat.js         对话存档：chats.json 的建 / 取 / 删与一轮的起止
lib/changelog.js    版本更新内容：读 changelog.json，客户端与发布共用一份
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

## 设置页

左侧二级菜单四项，当前子页写在 hash 里（`#settings?tab=ai|mastergo|agent|update`），复制链接可以直接进对应子页。
两栏都撑满一屏：菜单栏高度固定、右栏自己滚，页面本身不往下拖。

| 子页 | 内容 |
| --- | --- |
| AI token | 厂商 / base_url / 模型名 / API key |
| MasterGo token | 设计稿取数凭证（取值链里的「本机保存」那一级） |
| AI Agent | Agent 写盘开关、Codex 引擎版本、运行时（Node / PowerShell 7 / Claude Code 检测） |
| 更新 | 程序更新（检查 / 下载 / 切换 / 回退）与运行环境明细 |

界面上的文案一律面向使用者（产品 / 功能 / 更新说明），不写「怎么实现的」。下面各节写实现，是给改代码的人看的。

## 模型凭据

在「设置」页填厂商 / base_url / 模型名 / API key。key 用 Windows DPAPI（当前用户）加密后存在安装目录的 `credentials`，不写进任何产物、不进日志。

厂商表只列**核实过**的默认值（当前只有 DeepSeek，取自 `~/.codex/config.toml` 的 `model_providers.deepseek`）；其余厂商走「自定义」，填 OpenAI 兼容的 base_url。

## MasterGo 取数凭证

取设计稿（页面名、图层、图标几何）要用，取值顺序只有一处实现（`lib/mcp-token.js`）：

1. 启动参数 `--token`
2. 环境变量 `MASTERGO_MCP_TOKEN`
3. 本机保存：设置页填的，DPAPI 加密后存在安装根的 `mastergo-credentials`
4. `~/.codex/config.toml` 里的 `--token=mg_xxx`

每次用之前现取，所以设置页保存后立刻生效，不用重启客户端。设置页会显示当前生效的是哪一级；
本机保存了却不是它在生效时给出提示。值只经环境变量交给子进程，不进命令行也不落产物。

## 口径来自插件，本仓库只做编排

控件 ID、映射命中、控件 XML、整页流水线全部由 `mastergo-wpf-transcoder` 插件内的脚本产出，与 Codex / Claude Code 走的是同一份实现。本仓库只负责界面、编排与转发：查询引擎 `lib/node-controls.js` 逐个子进程调用插件的取数、固化快照、mapping、控件代码发射脚本，ID 直接 `require` 插件的 `lib/page-node-id.js`。

插件根的查找顺序：

1. `--plugin <目录>`
2. 我指定的那一份（在插件页表里那一行的操作列上换：指定一个目录… / 换个目录… / 交给客户端找）
3. 环境变量 `MASTERGO_PLUGIN_ROOT`
4. `<CODEX_HOME>/plugins/cache` 下的同名插件（有版本目录时取最高版本）
5. `<CODEX_HOME>/plugins/marketplaces`
6. `~/.claude/plugins/cache`
7. `~/.claude/plugins/marketplaces`
8. 客户端自带的 `plugins/`（客户端能给自己装一份，见下一段）

八档都没命中时**直接失败并报告已查找的路径**：客户端不随包（zip）分发插件，要用自带那一份就按下一段自己装；
插件本体一条实现仍然只在插件仓库那一处，本仓库不自带引擎副本。

插件页就是这个顺序本身：上面一条顺序（八档，没设的也列出来），下面一张表（来源 / 版本 / 状态 / 路径 / 操作；
同一份插件只列一行），点某一行开它的详情，点「客户端自带」那一行开它的管理（检查更新 / 下载并安装 / 进度）。
「从哪儿取」这件事只属于「客户端自带」那一份，所以它也在那个管理面板里：**更新来源**（类型 / 地址 /
修改发布源，与程序更新是**同一处设置**：公网 GitHub、公司 GitLab、内网静态目录都行，改一处两边都按新的走）。

「客户端自带」那一份不用先装 Codex / Claude：设置 → 更新 → 插件（流水线）里它的「管理…」里点「下载并安装」，
客户端按发布件里的 `plugin-manifest.json`（与客户端本体同一套协议：一份清单 + 按 sha256 取文件）
下到 `<安装根>\plugins\mastergo-wpf-transcoder\<插件版本>\`。查找顺序里它排在缓存/市场之后，
装完在插件页点那一行的「用这份」才换过去（那几处都没有插件时，装完就是它生效）。

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

看板页的主体是任务表（一页十条，翻页看历史）；工程、模式、链接这些只在要加任务时填，
收在「创建任务」弹窗里（`ui/src/app/board-new-task-dialog.tsx`，表单状态在 `ui/src/lib/board-form.ts`）。

同一页面重复跑：合并就是覆盖写入主工程，工程里任何时刻只有一份；看板保留历史记录，后合并的那一单标「生效中」，
更早的标「已被覆盖」并按「只看生效」藏起来（开关可随时放出来看）。

界面功能点每次改完的实点结论记在 `docs/ui-verification.md`。

## 对话

左边的对话列表来自 `lib/chat.js` 的存档：一次提问一条记录，按对话归堆，落在安装根的 `chats.json`，
重开页面还在；标题取第一句，来源那一行是这次跑的是哪份 Codex。删除只删这一条记录。

存的是引擎原始输出行，解析只有前端一处（`ui/src/lib/agent-stream.ts`）：重放存档与实时收流走同一条解析，
换引擎输出格式时只改那一处。续跑认 thread id（`codex exec resume`），所以在同一条对话里接着说就是接着上次的上下文。

工具调用每次占一行（命令 / 文件改动 / MCP 工具 / 联网搜索 / 思考），点开才铺细节，默认全收起；
命令行一开跑就出现，跑完才补上退出码。引擎只给「改了哪些文件（路径 + add/update/delete）」，不给行数。

## 对话附件

对话框支持图片 / 文件 / 文件夹，也可以直接拖进来。浏览器读成 base64 → `POST /api/agent/upload`
→ 落在安装根的 `chats/uploads/<批次>/`（选文件夹时子目录照原样保留，重名不覆盖，单文件 ≤ 25 MB、
一批 ≤ 40 MB）。图片经 Codex 的 `-i` 直接给它看，其余文件在提示词里给路径让它自己读。
这一条接口的请求体上限单独放到 56 MB（`lib/uploads.js` 的 `MAX_BODY_BYTES`），别的接口仍是 1 MiB。

预览/缩略图走 `GET /api/agent/file?path=…`，这条路由只认 `chats/uploads/` 里的路径 ——
界面上报什么路径都不能直接信。附件属于用户状态，不随程序版本走。

## 参考源

对话页顶上挑、点旁边「管理」改：一份参考源 = 一组代码库（路径 + 是什么库 + 说明，可多条、可临时停用）
加一段系统提示词。可以存多份，**每条对话在顶上挑一份**生效（对话上记着 `templateId`，
没记过就按设置里的 `activeTemplateId` -> 第一份）。

提问时它拼在提示词最前面（`lib/agent-context.js` 的 `buildContext`），
AI 因此知道去哪读文件、按什么规矩答，不用每次交代；选哪份的规则在 `pickTemplate` 一处。

参考源里的「浏览…」走 `POST /api/system/pick-folder`（Windows 弹系统文件夹选择框，异步 spawn，不卡服务）；
取消或打不开都回空路径，界面退回落手填。

## 加载动画

加载时统一是那只像素小狐狸（`ui/src/app/pixel-mascot.tsx` 的字符网格精灵图）：
手指从左边一个字一个字指过去，指到的字往下跳一下，指到头收手，停 0–3 秒再来一遍；
系统设了「减少动态效果」就只静态显示。等待文案统一成「请稍等，正在XXXX」（`ui/src/app/pixel-loader.tsx`）。

浏览器标签图标 `ui/public/favicon.svg` 是同一张图（静态图标没法 import 模块，改形象时两处一起改）；
React 挂载前的那一下由 `ui/index.html` 里的静态占位顶上（直接引 favicon，不再另画一份）。

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
清单里还带 `notes`（这一版改了什么）与 `changelog.json`：更新页显示每个版本的内容，断网也看得到。
发版时 `scripts/publish.js` 同时用 `changelog.json` 写上 GitHub Release 说明，一处内容三个出口。

更新页更新的是**客户端自己**（界面 + 编排 + 引擎集成），不含插件 —— 插件按自己的版本走，
在「设置 → 更新 → 插件（流水线）」那一页看（客户端自带那一行的「管理…」里有检查更新 / 下载并安装）。
版本列表按版本号从新到旧列：装好的标「正在用 / 可切换 / 文件不全」，
远端清单里那一版标「有新版」，每一行下面就是这一版改了什么。

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

切版本立刻生效：`launch.js` 是监督进程，子进程收到 `POST /api/client/restart` 就以约定退出码 75 退出，
监督进程按新指针重新起一份（子进程环境带 `MASTERGO_SUPERVISED=1`，界面据此判断能不能自动生效）。
界面在切换期间盖一层转圈遮罩，起来后自己刷新；没有监督进程（直接 `node server.js` 起的）时退回「下次启动生效」。
启动路径上不做同步的 pwsh 探测（运行时的版本改在「设置 → AI Agent」按需取），所以空窗只有约 0.3 秒。

能切的只有「坏了也不影响核心流程」的东西：

| 组件 | 策略 | 能否切换 |
| --- | --- | --- |
| 程序本身 | 差分下载 → `versions/` 并存 → 指针切 | 能，含回退 |
| 配置 / 映射层 | 走插件版本，不在这条线上 | 不适用 |
| Node / PowerShell 7 | 在关键路径上，坏了整个客户端起不来 | 不参与切换 |

用户状态（`local.json`、`credentials`、`board.json`、`chats.json`、`work/`）永远在安装根，不随版本目录走。

## 依赖

- Node.js（跑后端与构建前端）
- `mastergo-wpf-transcoder` 插件
- `pwsh`（PowerShell 7；5.1 的 GBK 编码会破坏中文）
