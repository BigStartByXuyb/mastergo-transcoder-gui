#!/usr/bin/env node
"use strict";
/*
 * server.js —— 「MTSLG 控件 ID 查询」本地 GUI 服务。
 *
 * 一件事：输入 MasterGo 链接（页面帧/容器，或控件），返回控件在 MTSLG IOContorl 里应该用的 ID
 * （命中正式映射表的控件同时给出可直接粘贴的控件代码）。**不做整页转码**。
 *
 * 用法：
 *   node server.js                                  # 起服务并打开浏览器
 *   node server.js --port 8787 --no-open
 *   node server.js --project D:\SSD_YinQie_F2ContinuousRunData   # 自动发现该工程的页面帧（离线优先）
 *   node server.js --snapshot <dsl.snapshot.json>    # 完全离线：只用一份快照
 *   node server.js --token mg_xxx                    # 缺省取 env MASTERGO_MCP_TOKEN，再取 ~/.codex/config.toml
 *   node server.js --plugin <插件目录>               # 显式指定 mastergo-wpf-transcoder 插件根；
 *                                                    # 缺省自动在 ~/.codex 与 ~/.claude 的插件缓存里找
 *
 * ID 不在这里算：统一由 skills/mastergo-to-wpf/scripts/resolve-node-control.js 产出
 * （它内部转调 lib/page-node-id.js，与转码器同一份公式）。
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  parseLink,
  findNodesByLayerId,
  isPageLevelLink,
  describeCaptureFailure,
  discoverFrames
} = require(path.join(__dirname, "lib", "resolve-target.js"));
const { resolvePluginRoot } = require(path.join(__dirname, "lib", "plugin-root.js"));

const HERE = __dirname;
const PUBLIC_DIR = path.join(HERE, "public");
const CAPTURE_TIMEOUT_MS = 10 * 60 * 1000;

// 命令行为
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

// 引擎一律来自插件：找不到就停，不用自带副本（同一逻辑只有一个实现）。
const PLUGIN_ROOT = resolvePluginRoot(options.plugin);
const ENGINE = path.join(PLUGIN_ROOT, "skills", "mastergo-to-wpf", "scripts", "resolve-node-control.js");

// token：命令行 > 环境变量 > ~/.codex/config.toml（不写进任何产物）
function resolveToken() {
  if (options.token) return options.token;
  if (process.env.MASTERGO_MCP_TOKEN) return process.env.MASTERGO_MCP_TOKEN;
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = path.join(home, "config.toml");
  try {
    const hit = /--token=(mg_[A-Za-z0-9_\-]+)/.exec(fs.readFileSync(configPath, "utf8"));
    if (hit) return hit[1];
  } catch (error) {
    return "";
  }
  return "";
}
const TOKEN = resolveToken();

const workRoot = path.join(os.tmpdir(), "mtslg-node-id-gui");
fs.mkdirSync(workRoot, { recursive: true });

// 缓存：抓取结果（同 fileId+layerId 不重复打 MCP）
const captureCache = new Map();
// 页面帧表：fileId → [{ layerId, name, from, snapshotPath, verified }]
// 一个设计文件可以有多个页面帧（同一 fileId 下不同画面），所以是列表而不是单值。
const frameIndex = new Map();
const VERIFIED_FROM = new Set(["page-registry", "manifest", "snapshot", "frame-link"]);

function registerFrame(frame) {
  if (!frame || !frame.fileId || !frame.layerId) return;
  const verified = frame.verified === undefined ? VERIFIED_FROM.has(frame.from) : frame.verified;
  const list = frameIndex.get(frame.fileId) || [];
  const existing = list.find((item) => item.layerId === frame.layerId);
  if (existing) {
    if (frame.snapshotPath && !existing.snapshotPath) existing.snapshotPath = frame.snapshotPath;
    if (verified && !existing.verified) {
      existing.verified = true;
      existing.from = frame.from;
    }
    return;
  }
  list.unshift({
    fileId: frame.fileId,
    layerId: frame.layerId,
    name: frame.name || "",
    from: frame.from || "link",
    snapshotPath: frame.snapshotPath || "",
    verified: verified
  });
  frameIndex.set(frame.fileId, list);
}

// 试帧顺序：有本地快照的先试（离线、快），再按"已验证"优先，最后按登记时间倒序。
function framesOf(fileId) {
  return (frameIndex.get(fileId) || []).slice().sort(function (left, right) {
    const snapshotDiff = (right.snapshotPath ? 1 : 0) - (left.snapshotPath ? 1 : 0);
    if (snapshotDiff !== 0) return snapshotDiff;
    return (right.verified ? 1 : 0) - (left.verified ? 1 : 0);
  });
}

function refreshProjectFrames() {
  const roots = [];
  if (options.project) roots.push(options.project);
  roots.push(process.cwd());
  for (const frame of discoverFrames(roots, { maxDepth: 4 })) registerFrame(frame);
  if (options.snapshot) {
    const snapshot = readJson(options.snapshot);
    const fileId = snapshot && snapshot.fileId ? String(snapshot.fileId) : "";
    const root = snapshot && snapshot.dsl && Array.isArray(snapshot.dsl.nodes) ? snapshot.dsl.nodes[0] : null;
    if (fileId && root && root.id) {
      registerFrame({
        fileId: fileId,
        layerId: String(root.id),
        name: String(root.name || ""),
        from: "snapshot",
        snapshotPath: path.resolve(options.snapshot)
      });
    }
  }
}

refreshProjectFrames();

class UserError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint || "";
    this.userFacing = true;
  }
}

// 抓取一个节点为根的 DSL，并补齐每个节点的 ID（引擎产出）
function captureNode(target, fileId) {
  const key = (fileId || "") + "|" + target.layerId;
  if (captureCache.has(key)) return captureCache.get(key);

  const runDir = fs.mkdtempSync(path.join(workRoot, "capture-"));
  const outPath = path.join(runDir, "node-controls.json");
  const args = [ENGINE, "--out", outPath, "--quiet", "--work-dir", runDir];
  if (target.snapshotPath) {
    args.push("--snapshot", target.snapshotPath);
  } else {
    if (!fileId) throw new UserError("NEED_FILE", "链接里没有 file=，无法定位设计文件", "请在 MasterGo 里选中节点后复制链接。");
    if (!TOKEN) throw new UserError("NEED_TOKEN", "缺少 MasterGo token，取不到设计稿", "在 ~/.codex/config.toml 里配置 mastergo MCP token，或设环境变量 MASTERGO_MCP_TOKEN，或用 --token 启动本工具。");
    args.push("--file-id", fileId, "--layer-id", target.layerId);
  }

  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    // token 通过环境变量传给子进程：既不落在命令行（进程列表可见），也不写进任何产物。
    env: TOKEN ? Object.assign({}, process.env, { MASTERGO_MCP_TOKEN: TOKEN }) : process.env,
    timeout: CAPTURE_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().slice(0, 1200);
    const failure = describeCaptureFailure(detail, target.layerId);
    throw new UserError(failure.code, failure.message, failure.hint);
  }

  const payload = readJson(outPath);
  if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0) {
    throw new UserError("EMPTY_NODES", "没抓到节点（" + target.layerId + "）", "确认链接指向的是设计稿里的容器/控件，且该图层仍在画布上。");
  }
  const capture = {
    pageKey: String(payload.pageKey || ""),
    source: String(payload.source || ""),
    snapshotPath: target.snapshotPath || "",
    nodes: payload.nodes
  };
  captureCache.set(key, capture);
  return capture;
}

function summarize(capture) {
  const nodes = capture.nodes || [];
  return {
    pageKey: capture.pageKey,
    source: capture.source,
    totalCount: nodes.length,
    mappedCount: nodes.filter((node) => node.xml).length
  };
}

// 主流程：链接 → 控件 ID（单控件，或整个容器里的控件清单）
function resolveQuery(request) {
  const startedAt = Date.now();
  const parsed = parseLink(request.link);
  const frameHint = request.frameLink ? parseLink(request.frameLink) : { fileId: "", layerId: "", pageId: "" };
  const fileId = parsed.fileId || frameHint.fileId;
  const layerId = parsed.layerId || frameHint.layerId;
  if (!layerId) {
    throw new UserError(
      "NEED_LAYER",
      parsed.pageId ? "链接里只有 page_id，没有具体图层" : "链接里没有 layer_id",
      "请在 MasterGo 画布上选中那个容器（页面帧）或控件，再用「复制链接」，链接里会带 layer_id。"
    );
  }
  // 页面链接（page_id 被当成 layer_id）在 MasterGo 侧必然取不到图层：提前拦住，别让它白等十几秒再报一句看不懂的错。
  if (isPageLevelLink(parsed) || isPageLevelLink(frameHint)) {
    throw new UserError(
      "PAGE_LINK",
      "贴的是「页面」链接，不是容器/控件",
      "这是页面（page_id=" + (parsed.pageId || frameHint.pageId) + "）的链接，MasterGo 取不到它的图层数据。"
        + "请在画布上选中那个容器（页面帧）或控件，再复制链接粘过来。"
    );
  }

  const notes = [];
  // 高级里显式给的页面帧链接：直接登记为已验证的页面帧。
  if (frameHint.layerId) {
    registerFrame({ fileId: fileId, layerId: frameHint.layerId, name: "", from: "frame-link", snapshotPath: "" });
  }

  // 已知页面帧（一个文件可能有多个：工程登记表 / 快照 / 之前贴过的页面帧链接）
  const frames = fileId ? framesOf(fileId) : [];

  // ① 贴的是控件，且在某个已知页面帧里找得到 → 直接给这一个控件的 ID（与整页转码一致）
  //    「自己就是页面帧」不进这个循环：拿自己当帧搜自己没有意义。
  for (const frame of frames) {
    if (frame.layerId === layerId) continue;
    const frameCapture = captureNode(frame, fileId);
    const hits = findNodesByLayerId(frameCapture.nodes, layerId);
    if (hits.length === 0) continue;
    if (hits.length > 1) notes.push("该 layer_id 在页面里出现 " + hits.length + " 次（图层被复用），已取最靠上的一个；请对照坐标确认。");
    return {
      ok: true,
      mode: "single",
      requested: parsed,
      frame: { layerId: frame.layerId, from: frame.from, verified: frame.verified },
      target: hits[0],
      candidates: hits.length > 1 ? hits : [],
      capture: summarize(frameCapture),
      nodes: frameCapture.nodes,
      notes: notes,
      elapsedMs: Date.now() - startedAt
    };
  }
  const otherFrames = frames.filter((frame) => frame.layerId !== layerId);
  if (otherFrames.length > 0) {
    notes.push("这个 layer_id 不在已登记的页面帧（" + otherFrames.map((frame) => frame.layerId).join("、") + "）里，已改为把链接本身当容器解析。");
  }

  // ② 把链接本身当容器（页面帧）：列出里面的控件与各自 ID
  const containerCapture = captureNode({ layerId: layerId, snapshotPath: "" }, fileId);
  if (fileId) {
    registerFrame({
      fileId: fileId,
      layerId: layerId,
      name: containerCapture.nodes[0] ? containerCapture.nodes[0].name : "",
      from: "link",
      snapshotPath: "",
      verified: false
    });
  }
  const frameEntry = (frameIndex.get(fileId) || []).find((item) => item.layerId === layerId) || { layerId: layerId, from: "link", verified: false };
  if (!frameEntry.verified) {
    notes.push("本次页面键取你贴的链接（" + layerId + "）。"
      + "若这其实是某个控件、而不是整页那个容器（页面帧），算出的 ID 会与整页转码不一致——"
      + "请改贴页面帧链接，或在「高级」里填工程目录/页面帧链接。");
  }
  return {
    ok: true,
    mode: "container",
    requested: parsed,
    frame: { layerId: layerId, from: frameEntry.from, verified: frameEntry.verified },
    target: null,
    candidates: [],
    capture: summarize(containerCapture),
    nodes: containerCapture.nodes,
    notes: notes,
    elapsedMs: Date.now() - startedAt
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return null;
  }
}

// /api/health 与启动日志用：把 fileId → [页面帧] 摊平成一维清单。
function framesOfAllFiles() {
  const all = [];
  for (const list of frameIndex.values()) {
    for (const frame of list) all.push(frame);
  }
  return all;
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

function serveStatic(response, urlPath) {
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.resolve(PUBLIC_DIR, relative);
  if (file.indexOf(PUBLIC_DIR) !== 0 || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("404");
    return;
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-store"
  });
  fs.createReadStream(file).pipe(response);
}

function readBody(request) {
  return new Promise(function (resolve, reject) {
    let text = "";
    request.on("data", function (chunk) {
      text += chunk;
      if (text.length > 1024 * 1024) reject(new UserError("BODY_TOO_LARGE", "请求体过大", ""));
    });
    request.on("end", function () {
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(new UserError("BAD_JSON", "请求不是合法 JSON", ""));
      }
    });
    request.on("error", reject);
  });
}

const server = http.createServer(function (request, response) {
  const url = new URL(request.url, "http://" + (request.headers.host || "127.0.0.1"));
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      hasToken: Boolean(TOKEN),
      engine: fs.existsSync(ENGINE),
      snapshot: options.snapshot ? path.resolve(options.snapshot) : "",
      frames: framesOfAllFiles()
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/resolve") {
    readBody(request).then(function (body) {
      if (body.projectDir) {
        for (const frame of discoverFrames([String(body.projectDir)], { maxDepth: 4 })) registerFrame(frame);
      }
      return resolveQuery({
        link: body.link,
        frameLink: body.frameLink || ""
      });
    }).then(function (payload) {
      sendJson(response, 200, payload);
    }).catch(function (error) {
      if (error && error.userFacing) {
        sendJson(response, 400, { ok: false, error: { code: error.code, message: error.message, hint: error.hint } });
        return;
      }
      sendJson(response, 500, { ok: false, error: { code: "INTERNAL", message: String(error && error.message ? error.message : error), hint: "" } });
    });
    return;
  }
  if (request.method === "GET") serveStatic(response, url.pathname);
  else {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("405");
  }
});

server.listen(options.port, options.host, function () {
  const actualPort = server.address().port;
  const url = "http://" + options.host + ":" + actualPort + "/";
  process.stdout.write("listening " + actualPort + "\n");
  process.stdout.write("MTSLG 控件 ID 查询: " + url + "\n");
  process.stdout.write("浏览器应已自动打开；若没打开，把上面的地址粘到浏览器里。\n");
  process.stdout.write("引擎: " + ENGINE + "（" + (fs.existsSync(ENGINE) ? "已找到" : "缺失") + "）\n");
  process.stdout.write("token: " + (TOKEN ? "已就绪" : "缺失（只有本地快照模式可用）") + "\n");
  const frames = framesOfAllFiles();
  process.stdout.write("已发现页面帧: " + frames.length + (frames.length ? " → " + frames.map((frame) => frame.fileId + "/" + frame.layerId + "(" + frame.from + ")").join(", ") : "") + "\n");
  if (options.open) openBrowser(url);
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
  } catch (error) {
    /* 打不开浏览器不影响服务本身 */
  }
}
