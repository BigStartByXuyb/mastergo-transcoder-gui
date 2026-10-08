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
 *   lib/system-open.js 交给系统打开（起完服务打开界面、插件页的「打开目录」）
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
const { openUrl } = require("./lib/system-open.js");

const { createResolver } = require("./lib/resolve.js");
const { readPipelineSteps, createPluginRuntime } = require("./lib/plugin.js");
const { createPluginHomes } = require("./lib/plugin-root.js");
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
const { createPluginUpdate } = require("./lib/plugin-update.js");
const { createCodex } = require("./lib/codex.js");
const { createRuntime, resolvePwshExe } = require("./lib/runtime.js");
const runtimePolicy = require("./lib/runtime-policy.js");
const { createChats } = require("./lib/chat.js");
const { createUploads } = require("./lib/uploads.js");
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

// 运行时「哪一份用系统上那份」只有一个来源：设置里那张逐份的表，现读（刚改完就生效）。
runtimePolicy.setSource(function () { return settings.read().runtime.system; });

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

/*
 * 插件从哪一份跑：命令行 > 设置里选的 > 环境变量 > Codex / Claude 缓存 > 客户端自带。
 * 一处都没有也照常起服务 —— 设置页要把「查过哪些路径」摆出来，人才知道去哪儿装。
 */
const pluginRuntime = createPluginRuntime({
  explicitDir: options.plugin,
  installRoot: HOME,
  settings: settings
});
const PLUGIN = pluginRuntime.current();

const workRoot = path.join(os.tmpdir(), "mtslg-transcoder-gui");
fs.mkdirSync(workRoot, { recursive: true });

// token 取值链只建一次，谁要都拿这一个闭包（设置里改完不重启也按新的走）。
const tokenOf = function () { return tokenSource.value(); };

const resolver = createResolver({
  engine: PLUGIN.engine,
  // 插件根每次现取：设置里换一份之后立刻生效，不用重启客户端。
  pluginRoot: function () { return PLUGIN.root; },
  // pwsh 也现取：换了运行时、或改了「允许用系统那份」之后，下一次查询就按新的走。
  pwsh: function () { return resolvePwshExe(); },
  token: tokenOf,
  project: options.project,
  snapshot: options.snapshot,
  workRoot: workRoot
});
resolver.refreshProjectFrames();

// token 交给运行管理器：插件脚本只认环境变量里的那一份（只在设置里填过的机器，否则第一步就报缺少 token）。
const runs = createRunManager({ plugin: PLUGIN, token: tokenOf });
const pending = createPending({ plugin: PLUGIN });
const ai = createAi({ settings: settings });
const artifacts = createArtifacts();
const confirm = createConfirm({
  runs: runs,
  pending: pending,
  steps: function () { return readPipelineSteps(PLUGIN.root); }
});
const autoFill = createAutoFill({ ai: ai, pending: pending, confirm: confirm, settings: settings });
const layoutRegistrar = createLayoutRegistrar({ pluginRoot: function () { return PLUGIN.root; } });
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
  isBusy: busyReason,
  // 源与 token 每次现取：设置里刚改完，「检查更新」立刻按新的走。有没有 token 走廉价判断，轮询不解密。
  source: function () { return settings.read().source; },
  token: function () { return settings.readSourceToken(); },
  hasToken: function () { return settings.read().source.hasToken; }
});
/*
 * 插件那一半：客户机上没有 Codex/Claude 时，客户端按发布件里的插件清单自己装一份，装在安装根
 * 的 plugins/ 下（插件定位里「客户端自带」那一条）。装完重新定位一次，这一份立刻可用。
 */
const pluginUpdate = createPluginUpdate({
  home: HOME,
  onInstalled: function () { pluginRuntime.reload(); },
  // 装完就是生效，所以和「换一份插件」同一道门禁：有任务在跑时先不换。
  isBusy: busyReason,
  /*
   * 插件有自己的版本线：它在插件仓库那边打 tag 时发同构的发布件，客户端直接消费它。
   * 插件读的是**自己那一项设置**（local.json 的 pluginSource）：没配／配坏了回插件仓库；
   * 与程序更新那项（source）互不影响。默认值与拼法只有 lib/source.js 的 pluginSourceOf 一处。
   */
  pluginSource: function () { return settings.pluginSource(); },
  // 凭据与源配套：插件这条线读插件那一份（不拿程序更新那条的 token 去请求另一个主机）。
  token: function () { return settings.readPluginSourceToken(); },
  // 与程序更新同一种廉价判断（状态轮询那条路读的就是它）：有没有 token 不解密。
  hasToken: function () { return settings.hasPluginSourceToken(); }
});
// Codex 引擎：只下载进安装根，用户的 ~/.codex 一概不动；对话与写盘由插件脚本负责。
const codex = createCodex({
  home: HOME,
  settings: settings,
  isBusy: busyReason,
  // 写盘防线要知道自定插件根在哪儿，不然「工程目录」填成插件本体就没人拦。
  pluginHomes: createPluginHomes({ pluginDir: options.plugin, chosenRoot: pluginRuntime.chosen })
});
// 运行时：客户端自带的 Node / PowerShell 7 与 claude 的检测结果，设置页的运行时卡片读它。
const runtime = createRuntime({
  home: HOME,
  isBusy: busyReason,
  // 安装包从哪儿取、要不要凭据：都现取（设置里刚改完，下一次下载就按新的走）。
  mirror: function () { return settings.read().runtime.mirror; },
  token: function () { return settings.readSourceToken(); }
});
// 对话存档：chats.json 在安装根，属于用户状态，不随程序版本走。
const chats = createChats({ home: HOME });
// 对话附件：落在 chats/uploads/<批次>/ 下，属于用户状态，不随程序版本走。
const uploads = createUploads(HOME);
const routes = createRoutes({
  resolver: resolver,
  plugin: PLUGIN,
  pluginRuntime: pluginRuntime,
  chats: chats,
  uploads: uploads,
  token: tokenOf,
  tokenSource: tokenSource,
  supervised: process.env.MASTERGO_SUPERVISED === "1",
  isBusy: busyReason,
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
  pluginUpdate: pluginUpdate,
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

server.listen(options.port, options.host, function () {
  const actualPort = server.address().port;
  const url = "http://" + options.host + ":" + actualPort + "/";
  process.stdout.write("listening " + actualPort + "\n");
  process.stdout.write("MasterGo 转码客户端 v" + VERSION + ": " + url + "\n");
  process.stdout.write("插件: " + (PLUGIN.root || "（没找到）") + (PLUGIN.version ? "（v" + PLUGIN.version + "）" : "") + "\n");
  if (pluginRuntime.failure()) process.stdout.write(pluginRuntime.failure() + "\n");
  process.stdout.write("引擎: " + (PLUGIN.engineExists ? "已找到" : "缺失") + " → " + PLUGIN.engine
    + (PLUGIN.queryMissing.length ? "（插件缺 " + PLUGIN.queryMissing.join("、") + "）" : "") + "\n");
  // 运行时的版本要起 pwsh / node 去问，一次约 1.4 秒 —— 那是同步阻塞，摆在这里会让
  // 换版本后的这几秒连不上变成两三秒。这条信息在「设置 → AI Agent」里按需取，启动路径上不问。
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
  // 之后每 10 分钟再查一次：界面顶上的「有新版」标注靠它保持新鲜。
  update.startWatch();
  // 插件那一半启动时静默查一次，之后与程序更新同一节拍复查：插件页那一行会自己亮「有新版」。
  void pluginUpdate.check({ silent: true });
  pluginUpdate.startWatch();
  void codex.check({ silent: true });
  // 打不开浏览器不影响服务本身：openUrl 把各种失败都归一成返回值（不 reject），这里不等结果。
  // 「哪个平台用哪条命令」与插件页的「打开目录」是同一处（lib/system-open.js），不在这里再写一份。
  if (options.open) void openUrl(url);
});
