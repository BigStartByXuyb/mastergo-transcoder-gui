#!/usr/bin/env node
"use strict";
/*
 * server.js —— 入口：解析命令行、装配依赖、启动 HTTP 服务。
 *
 * 职责边界：本文件只做装配与监听。
 *   lib/routes.js      路由表与分发
 *   lib/http.js        JSON 响应 / 请求体 / 静态文件
 *   lib/plugin-root.js 插件定位
 *   lib/plugin.js      插件信息与步骤契约
 *   lib/resolve.js     控件查询（链接 → 控件 ID）
 *
 * 用法：
 *   node server.js                                  # 起服务并打开浏览器（默认 127.0.0.1:8787）
 *   node server.js --port 9000 --no-open
 *   node server.js --project D:\SomeProject         # 从工程目录自动发现页面帧（离线优先）
 *   node server.js --snapshot <dsl.snapshot.json>    # 完全离线：只用一份快照
 *   node server.js --plugin <插件目录>               # 显式指定 mastergo-wpf-transcoder 插件根
 *   node server.js --token mg_xxx                    # 缺省按 env、本机保存、~/.codex/config.toml 的顺序找
 *
 * 引擎一律来自插件：找不到就停，不用自带副本（同一逻辑只有一个实现）。
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { createResolver } = require("./lib/resolve.js");
const { resolvePluginRoot } = require("./lib/plugin-root.js");
const { readPluginInfo, readPipelineSteps } = require("./lib/plugin.js");
const { createRoutes, dispatch } = require("./lib/routes.js");
const { createRunManager } = require("./lib/run.js");
const { createSettings } = require("./lib/settings.js");
const { createPending } = require("./lib/pending.js");
const { createAi } = require("./lib/ai.js");
const { createArtifacts } = require("./lib/artifacts.js");
const { createBoard } = require("./lib/board.js");
const { createConfirm } = require("./lib/confirm.js");
const { createAutoFill } = require("./lib/autofill.js");
const { createLayoutRegistrar } = require("./lib/plugin-layout.js");
const { createPendingQueue } = require("./lib/pending-queue.js");
const { createMapping } = require("./lib/mapping.js");
const { createUpdate } = require("./lib/update.js");
const { createCodex } = require("./lib/codex.js");
const { createRuntime } = require("./lib/runtime.js");
const { applyProxy } = require("./lib/proxy.js");
const { createTokenSource, SOURCE_LABELS } = require("./lib/mcp-token.js");

const HERE = __dirname;
const PUBLIC_DIR = path.join(HERE, "public");

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8")).version || "0.0.0";
  }
  catch {
    return "0.0.0";
  }
}
const VERSION = readVersion();

// ---- 命令行 ----
const argv = process.argv.slice(2);
function argValue(name, fallback) {
  const index = argv.indexOf("--" + name);
  if (index < 0) return fallback;
  const value = argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}
const options = {
  port: Number(argValue("port", "8787")),
  portExplicit: argv.indexOf("--port") >= 0,
  host: argValue("host", "127.0.0.1"),
  token: argValue("token", ""),
  project: argValue("project", ""),
  snapshot: argValue("snapshot", ""),
  plugin: argValue("plugin", ""),
  open: argv.indexOf("--no-open") < 0
};

// 用户状态与凭据都在安装根（HOME）；settings 要早于 token 取值链建好。
const HOME = process.env.MASTERGO_HOME || HERE;
const settings = createSettings(HOME);

// token 的来源与顺序只有 lib/mcp-token.js 一处：启动参数 > 环境变量 > 本机保存 > config.toml。
// 取值不缓存 —— 设置页里保存完立刻按新值走。
const tokenSource = createTokenSource({
  cli: options.token,
  home: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  settings: settings
});

// ---- 装配 ----
// 出网要走代理才有更新：先按环境变量/系统设置把代理立起来，后面的下载与 pwsh 子进程都跟着走。
const proxy = applyProxy();

let PLUGIN_ROOT;
try {
  PLUGIN_ROOT = resolvePluginRoot(options.plugin);
}
catch (error) {
  process.stderr.write(String(error && error.message ? error.message : error) + "\n");
  process.exit(2);
}
const PLUGIN = readPluginInfo(PLUGIN_ROOT);

const workRoot = path.join(os.tmpdir(), "mtslg-transcoder-gui");
fs.mkdirSync(workRoot, { recursive: true });

const resolver = createResolver({
  engine: PLUGIN.engine,
  pluginRoot: PLUGIN.root,
  pwsh: PLUGIN.pwsh,
  token: function () { return tokenSource.value(); },
  project: options.project,
  snapshot: options.snapshot,
  workRoot: workRoot
});
resolver.refreshProjectFrames();

const runs = createRunManager({ plugin: PLUGIN });
const pending = createPending({ plugin: PLUGIN });
const ai = createAi({ settings: settings });
const artifacts = createArtifacts();
const confirm = createConfirm({
  runs: runs,
  pending: pending,
  steps: function () { return readPipelineSteps(PLUGIN.root); }
});
const autoFill = createAutoFill({ ai: ai, pending: pending, confirm: confirm, settings: settings });
const layoutRegistrar = createLayoutRegistrar({ pluginRoot: PLUGIN.root });
const board = createBoard({
  runs: runs,
  pending: pending,
  autoFill: autoFill,
  layout: layoutRegistrar,
  artifacts: artifacts,
  home: HOME
});
const pendingQueue = createPendingQueue({ runs: runs, board: board, pending: pending });
const mapping = createMapping({ plugin: PLUGIN });

// 「现在能不能换版本」只有一个判据：流水线和看板任务都空着。程序更新与 Codex 共用这一份。
function busyReason() {
  const live = runs.list().filter(function (job) { return job.state === "running" || job.state === "stopping"; });
  if (live.length) return live.length + " 次流水线正在跑";
  const running = board.snapshot().running;
  return running ? running + " 个看板任务在跑（含建目录与合并）" : "";
}

// 程序更新：运行树是这一份（HERE），用户状态与已下载的版本都在安装根（HOME）。
const update = createUpdate({
  root: HERE,
  home: HOME,
  version: VERSION,
  isBusy: busyReason
});
// Codex 引擎：只下载进安装根，用户的 ~/.codex 一概不动；对话与写盘由插件脚本负责。
const codex = createCodex({ home: HOME, settings: settings, isBusy: busyReason });
// 运行时：客户端自带的 Node / PowerShell 7 与 claude 的检测结果，设置页的运行时卡片读它。
const runtime = createRuntime({ home: HOME, isBusy: busyReason });
const routes = createRoutes({
  resolver: resolver,
  plugin: PLUGIN,
  token: function () { return tokenSource.value(); },
  tokenSource: tokenSource,
  version: VERSION,
  runs: runs,
  settings: settings,
  pending: pending,
  ai: ai,
  artifacts: artifacts,
  board: board,
  confirm: confirm,
  pendingQueue: pendingQueue,
  mapping: mapping,
  update: update,
  codex: codex,
  runtime: runtime
});

// ---- 服务 ----
const server = http.createServer(function (request, response) {
  dispatch(routes, request, response, PUBLIC_DIR).catch(function (error) {
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end(String(error && error.message ? error.message : error));
  });
});

// 端口被占用（例如上一个窗口还开着）：没显式指定 --port 时自动往后找一个可用端口，别让双击的窗口一闪就退。
let portRetries = 0;
server.on("error", function (error) {
  if (error && error.code === "EADDRINUSE" && !options.portExplicit && portRetries < 10) {
    portRetries += 1;
    const nextPort = options.port + portRetries;
    process.stdout.write("端口 " + (nextPort - 1) + " 已被占用，改用 " + nextPort + "。\n");
    server.listen(nextPort, options.host);
    return;
  }
  if (error && error.code === "EADDRINUSE") {
    process.stdout.write("端口 " + (options.port + portRetries) + " 已被占用：换一个 --port，或先关掉之前那个窗口。\n");
    process.exit(1);
  }
  throw error;
});

function openBrowser(url) {
  try {
    if (process.platform === "win32") spawnSync("cmd", ["/c", "start", "", url], { windowsHide: true });
    else if (process.platform === "darwin") spawnSync("open", [url]);
    else spawnSync("xdg-open", [url]);
  }
  catch {
    /* 打不开浏览器不影响服务本身 */
  }
}

server.listen(options.port, options.host, function () {
  const actualPort = server.address().port;
  const url = "http://" + options.host + ":" + actualPort + "/";
  process.stdout.write("listening " + actualPort + "\n");
  process.stdout.write("MasterGo 转码客户端 v" + VERSION + ": " + url + "\n");
  process.stdout.write("插件: " + PLUGIN_ROOT + (PLUGIN.version ? "（v" + PLUGIN.version + "）" : "") + "\n");
  process.stdout.write("引擎: " + (PLUGIN.engineExists ? "已找到" : "缺失") + " → " + PLUGIN.engine
    + (PLUGIN.queryMissing.length ? "（插件缺 " + PLUGIN.queryMissing.join("、") + "）" : "") + "\n");
  process.stdout.write("运行时: " + runtime.status().tools.map(function (item) {
    return item.label + " " + (item.source ? (item.source === "bundled" ? "自带" : "系统") + " " + (item.version || "?") : "缺失");
  }).join(" / ") + "\n");
  process.stdout.write("代理: " + (proxy.filled.length
    ? "已按 Windows 系统设置补上 " + proxy.filled.join("、")
    : (proxy.enabled ? "按环境变量" : "未启用（直连）")) + "\n");
  process.stdout.write("token: " + (tokenSource.value()
    ? "已就绪（来源：" + (SOURCE_LABELS[tokenSource.source()] || "未知") + "）"
    : "缺失（只有本地快照模式可用）") + "\n");
  if (!fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
    process.stdout.write("界面: 未构建 —— 先跑 npm run build:ui，或开发时用 npm run dev:ui。\n");
  }
  const frames = resolver.framesOfAllFiles();
  process.stdout.write("已发现页面帧: " + frames.length
    + (frames.length ? " → " + frames.map((frame) => frame.fileId + "/" + frame.layerId + "(" + frame.from + ")").join(", ") : "") + "\n");
  // 后台自动检测新版：失败不出声，设置页自己按离线状态显示。
  void update.check({ silent: true });
  void codex.check({ silent: true });
  if (options.open) openBrowser(url);
});
