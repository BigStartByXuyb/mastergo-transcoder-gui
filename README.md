# mastergo-transcoder-gui

MasterGo 设计稿转 MTSLG IOContorl / MW WPF 的本地客户端。

前端 React + Vite + shadcn/ui，后端 Node 内置 `http`（零第三方运行时依赖），两者通过 HTTP 通信。

## 跑起来

```
双击 start.cmd
```

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
npm --prefix ui install        # 首次
npm run api                    # 起后端（8787，不打开浏览器）
npm run dev:ui                 # 另开一个窗口：Vite dev server（5173），/api 代理到 8787
npm run build:ui               # 构建前端 → public/
```

## 目录

```
ui/            前端源码（shadcn CLI 生成 components/ui/，源码入库）
public/        前端构建产物（vite build --outDir ../public），不手工编辑
server.js      入口：命令行、装配、监听
lib/           后端实现：http 工具、路由表、插件定位、插件契约、控件查询
```

## 引擎来自插件，本仓库不自带

控件 ID、映射命中、控件 XML、整页流水线全部由 `mastergo-wpf-transcoder` 插件内的脚本产出，与 Codex / Claude Code 走的是同一份实现。本仓库只负责界面与转发。

插件根的查找顺序：

1. `--plugin <目录>`
2. 环境变量 `MASTERGO_PLUGIN_ROOT`
3. `<CODEX_HOME>/plugins/{cache,marketplaces}` 下的同名插件（有版本目录时取最高版本）
4. `~/.claude/plugins/{cache,marketplaces}` 下的同名插件（同上）

四项都没命中时**直接失败并报告已查找的路径**，不回退到自带副本。

插件内需要：

- `skills/mastergo-to-wpf/scripts/resolve-node-control.js` —— 控件查询引擎
- `skills/mastergo-to-wpf/scripts/entry/run-all.ps1` —— 整页流水线入口，界面按它 `-List` 返回的步骤契约渲染

## 依赖

- Node.js（跑后端与构建前端）
- `mastergo-wpf-transcoder` 插件
- `pwsh`（PowerShell 7；5.1 的 GBK 编码会破坏中文）
