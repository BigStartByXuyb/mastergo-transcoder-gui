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
 *   node server.js --token mg_xxx                    # 缺省取 env MASTERGO_MCP_TOKEN，再取 ~/.codex/config.toml
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

// token：命令行 > 环境变量 > ~/.codex/config.toml（不写进任何产物）
function resolveToken() {
  if (options.token) return options.token;
  if (process.env.MASTERGO_MCP_TOKEN) return process.env.MASTERGO_MCP_TOKEN;
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  try {
    const hit = /--token=(mg_[A-Za-z0-9_\-]+)/.exec(fs.readFileSync(path.join(home, "config.toml"), "utf8"));
    if (hit) return hit[1];
  }
  catch {
    return "";
  }
  return "";
}
const TOKEN = resolveToken();

// ---- 装配 ----
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
  token: TOKEN,
  project: options.project,
  snapshot: options.snapshot,
  workRoot: workRoot
});
resolver.refreshProjectFrames();

const runs = createRunManager({ plugin: PLUGIN });
const HOME = process.env.MASTERGO_HOME || HERE;
const settings = createSettings(HOME);
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
  home: HOME
});
const routes = createRoutes({
  resolver: resolver,
  plugin: PLUGIN,
  version: VERSION,
  runs: runs,
  settings: settings,
  pending: pending,
  ai: ai,
  artifacts: artifacts,
  board: board,
  confirm: confirm
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
  process.stdout.write("引擎: " + (PLUGIN.engineExists ? "已找到" : "缺失") + " → " + PLUGIN.engine + "\n");
  process.stdout.write("token: " + (TOKEN ? "已就绪" : "缺失（只有本地快照模式可用）") + "\n");
  if (!fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
    process.stdout.write("界面: 未构建 —— 先跑 npm run build:ui，或开发时用 npm run dev:ui。\n");
  }
  const frames = resolver.framesOfAllFiles();
  process.stdout.write("已发现页面帧: " + frames.length
    + (frames.length ? " → " + frames.map((frame) => frame.fileId + "/" + frame.layerId + "(" + frame.from + ")").join(", ") : "") + "\n");
  if (options.open) openBrowser(url);
});
