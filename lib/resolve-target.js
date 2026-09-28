"use strict";
/*
 * resolve-target.js —— GUI 服务的纯逻辑（可离线单测）：链接解析 / 页面帧发现 / 控件定位。
 *
 * 这里**不算 ID**：ID 一律由 scripts/resolve-node-control.js（内部转调 lib/page-node-id.js）
 * 给出，保证与转码产物完全一致。
 */

const fs = require("fs");
const path = require("path");

// 扫描工程目录时跳过的重目录（不跳 node_modules 会慢到不可用）。
const SKIP_DIRS = new Set(["node_modules", ".git", "bin", "obj", ".vs", "dist", "build", "packages", ".idea"]);

// 从 MasterGo 链接里取 file / layer_id / page_id（也接受只贴 "1158:251921" 这种 layer_id）。
function parseLink(link) {
  const text = String(link === undefined || link === null ? "" : link).trim();
  const out = { fileId: "", layerId: "", pageId: "" };
  const file = /[?&]file=([0-9]+)/.exec(text);
  if (file) out.fileId = file[1];
  const layer = /[?&]layer_id=([^&\s]+)/.exec(text);
  if (layer) out.layerId = safeDecode(layer[1]);
  const page = /[?&]page_id=([^&\s]+)/.exec(text);
  if (page) out.pageId = safeDecode(page[1]);
  if (!out.layerId && /^[0-9]+:[0-9]+$/.test(text)) out.layerId = text;
  return out;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value).trim();
  } catch (error) {
    return String(value).trim();
  }
}

// 在快照节点表里按"自身 layer_id"定位控件（ref 末段即自身 layer_id）。
function findNodesByLayerId(nodes, layerId) {
  const wanted = String(layerId || "").trim();
  if (!wanted) return [];
  const hits = (nodes || []).filter((node) => node && (node.layerId === wanted || node.ref === wanted));
  return hits.sort(function (left, right) {
    const depthDiff = refDepth(left.ref) - refDepth(right.ref);
    if (depthDiff !== 0) return depthDiff;
    return String(left.ref).localeCompare(String(right.ref));
  });
}

function refDepth(reference) {
  return String(reference || "").split("/").length;
}

// 贴的是「页面」链接：page_id 被当成 layer_id 传了。这类链接 MasterGo 侧必然返回空节点，
// 必须在取设计稿之前就拦住（否则要等十几秒才看到一句看不懂的错误）。
function isPageLevelLink(parsed) {
  if (!parsed || !parsed.layerId || !parsed.pageId) return false;
  return parsed.layerId === parsed.pageId;
}

// 把引擎的失败输出翻译成给人看的错误。
// 只匹配 ASCII 片段（`dsl.nodes[]`）：PowerShell 的中文提示在不同控制台编码下会变成乱码，
// 拿中文去匹配会失效，而 ASCII 标记不会。
function describeCaptureFailure(stderr, layerId) {
  const text = String(stderr === undefined || stderr === null ? "" : stderr).trim();
  if (text.indexOf("dsl.nodes[]") >= 0) {
    return {
      code: "EMPTY_DSL",
      message: "取不到该图层的数据（layer_id=" + layerId + "）",
      hint: "常见原因：① 贴的是「页面」链接，而不是具体容器/控件（请在画布上选中容器或控件后再复制链接）；"
        + "② 该页画布在 MasterGo 里还没加载完（先打开这个文件、切到该页面，等画布加载完成后重试）；"
        + "③ token 没有这个文件的权限。"
    };
  }
  if (/token/i.test(text)) {
    return { code: "NEED_TOKEN", message: "MasterGo token 不可用", hint: text.slice(0, 400) };
  }
  return { code: "CAPTURE_FAILED", message: "取设计稿失败（" + layerId + "）", hint: text.slice(0, 800) };
}

// 扫描工程目录：拿到 "fileId → 页面帧 layer_id（+ 本地快照路径）"，这样贴控件链接也能离线算出正确 ID。
function discoverFrames(roots, options) {
  const opts = options || {};
  const maxDepth = typeof opts.maxDepth === "number" ? opts.maxDepth : 4;
  const found = [];
  const seen = new Set();
  for (const root of roots || []) {
    if (root && fs.existsSync(root)) walkForFrames(path.resolve(root), 0, maxDepth, found, seen);
  }
  return found;
}

function walkForFrames(dir, depth, maxDepth, found, seen) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth >= maxDepth || SKIP_DIRS.has(entry.name)) continue;
      walkForFrames(full, depth + 1, maxDepth, found, seen);
      continue;
    }
    if (entry.name === "page-registry.json") collectFromPageRegistry(full, found, seen);
    else if (entry.name === "manifest.json") collectFromRunManifest(full, found, seen);
  }
}

function collectFromPageRegistry(file, found, seen) {
  const data = readJson(file);
  if (!data || !Array.isArray(data.pages)) return;
  for (const page of data.pages) {
    const source = page && page.designSource ? page.designSource : null;
    if (!source) continue;
    pushFrame(found, seen, {
      fileId: String(source.fileId || ""),
      layerId: String(source.layerId || ""),
      pageId: String(source.pageId || ""),
      name: String(source.designPageName || page.target || ""),
      from: "page-registry",
      snapshotPath: findSiblingSnapshot(path.dirname(path.dirname(file)))
    });
  }
}

function collectFromRunManifest(file, found, seen) {
  const data = readJson(file);
  if (!data || String(data.schemaVersion || "").indexOf("mastergo-dsl-run") !== 0) return;
  pushFrame(found, seen, {
    fileId: String(data.fileId || ""),
    layerId: String(data.layerId || ""),
    pageId: "",
    name: String(data.pageName || ""),
    from: "manifest",
    snapshotPath: findSiblingSnapshot(path.dirname(file))
  });
}

function findSiblingSnapshot(dir) {
  const direct = path.join(dir, "dsl.snapshot.json");
  if (fs.existsSync(direct)) return direct;
  const underGenerated = path.join(dir, "Generated", "dsl.snapshot.json");
  if (fs.existsSync(underGenerated)) return underGenerated;
  // 采集产物按页归档后位于 <项目>/Generated/runs/<页面名>/dsl.snapshot.json
  const runsDir = path.join(dir, "Generated", "runs");
  if (fs.existsSync(runsDir)) {
    for (const entry of fs.readdirSync(runsDir)) {
      const candidate = path.join(runsDir, entry, "dsl.snapshot.json");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "";
}

function pushFrame(found, seen, frame) {
  if (!frame.fileId || !frame.layerId) return;
  const key = frame.fileId + "|" + frame.layerId;
  if (seen.has(key)) return;
  seen.add(key);
  found.push(frame);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return null;
  }
}

module.exports = { parseLink, findNodesByLayerId, refDepth, isPageLevelLink, describeCaptureFailure, discoverFrames };
