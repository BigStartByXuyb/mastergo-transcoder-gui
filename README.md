# mastergo-transcoder-gui

MasterGo 设计稿转 MTSLG IOContorl / MW WPF 的本地客户端。

浏览器作前端，Node 内置 `http` 作后端，零第三方依赖。

## 跑起来

```
双击 start.cmd
```

服务默认监听 `127.0.0.1:8787` 并自动打开浏览器。

```
node server.js --port 9000 --no-open
node server.js --project <工程目录>          # 从工程的 DSL 快照与登记表自动发现页面帧（离线优先）
node server.js --snapshot <dsl.snapshot.json>  # 完全离线：只用一份快照
node server.js --plugin <插件目录>           # 显式指定插件根
node server.js --token mg_xxx                # 缺省取 env MASTERGO_MCP_TOKEN，再取 ~/.codex/config.toml
```

## 引擎来自插件，本仓库不自带

节点 ID、映射命中、控件 XML 全部由 `mastergo-wpf-transcoder` 插件内的脚本产出，与 Codex / Claude Code 走的是同一份实现。本仓库只负责界面与转发。

插件根的查找顺序：

1. `--plugin <目录>`
2. 环境变量 `MASTERGO_PLUGIN_ROOT`
3. `<CODEX_HOME>/plugins/{cache,marketplaces}` 下的同名插件（有版本目录时取最高版本）
4. `~/.claude/plugins/{cache,marketplaces}` 下的同名插件（同上）

四项都没命中时**直接失败并报告已查找的路径**，不回退到自带副本。

插件内必须存在 `skills/mastergo-to-wpf/scripts/resolve-node-control.js`（本 GUI 调用的入口），它内部转调同一目录下的 `lib/page-node-id.js`。

## 依赖

- Node.js
- `mastergo-wpf-transcoder` 插件
- `pwsh`（仅链接取数模式需要，离线快照模式不需要）

## 边界

- 只回答"某个控件该用哪个 ID"和"命中映射表时可用什么控件代码"，不做整页转码。
- 整页转码走插件的 `run-all.ps1` 流水线，与本 GUI 是同一引擎的两个入口。
