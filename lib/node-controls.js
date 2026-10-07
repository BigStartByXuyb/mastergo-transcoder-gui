#!/usr/bin/env node
"use strict";
/*
 * node-controls.js —— 控件查询引擎（GUI 侧编排，插件侧实现）。
 *
 * 输入：MasterGo 容器链接（fileId + layerId）或本地 DSL 快照。
 * 输出：容器内每个节点的页面 ID（MX_…）；命中正式映射表的节点附带可直接粘贴的控件代码。
 *
 * 分工：本文件只负责编排与展示字段，所有口径都取插件里的实现，不复制公式——
 *   core/call-mastergo-mcp.js                     取 getDsl（响应只落盘）
 *   core/mastergo-dsl-pipeline.ps1 -Action Capture 固化快照（节点 id 变成页内全路径 ref）
 *   core/resolve-mastergo-visibility.js           显隐事实
 *   adapters/mtslg-iocontrol/gen-mtslg-mapping-from-dsl.js  推导 mapping
 *   adapters/mtslg-iocontrol/gen-iocontrol-xml.js           发射整页控件代码
 *   lib/page-node-id.js                           页面节点 ID 公式的唯一实现
 *
 * 用法:
 *   node lib/node-controls.js --plugin <插件根> --out <node-controls.json> --work-dir <目录>
 *     (--snapshot <dsl.snapshot.json> | --file-id <id> --layer-id <79:162125>)
 *     [--ui <区域前缀>] [--pwsh <pwsh 路径>] [--quiet]
 *
 * token 只走环境变量 MASTERGO_MCP_TOKEN（不落命令行、不落产物）。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { extractXmlChunk } = require("./xml-chunk.js");
const { childOutputDetail, DETAIL_LIMITS } = require("./ansi.js");

// 查询用的快照是一次性的：ui 只写进快照的 ui 字段，不参与 ID 公式，也不进控件代码。
const DEFAULT_UI = "F2";

// 路径都相对 skills/mastergo-to-wpf（脚本在 scripts/ 下，映射表在 references/ 下）。
const PLUGIN_FILES = {
  mcpTool: ["scripts", "core", "call-mastergo-mcp.js"],
  capture: ["scripts", "core", "mastergo-dsl-pipeline.ps1"],
  visibility: ["scripts", "core", "resolve-mastergo-visibility.js"],
  mapping: ["scripts", "adapters", "mtslg-iocontrol", "gen-mtslg-mapping-from-dsl.js"],
  xml: ["scripts", "adapters", "mtslg-iocontrol", "gen-iocontrol-xml.js"],
  templateMap: ["references", "adapters", "mtslg-iocontrol", "mtslg-iocontrol-map.json"],
  pageNodeId: ["scripts", "lib", "page-node-id.js"]
};

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail("无法识别的参数: " + token);
    const key = token.slice(2);
    if (key === "quiet") { out.quiet = true; continue; }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail("--" + key + " 缺少取值");
    index += 1;
    out[key] = value;
  }
  return out;
}

function skillRoot(pluginRoot) {
  return path.join(pluginRoot, "skills", "mastergo-to-wpf");
}

// 只回答"插件里这些文件在不在"：缺一个就直接说缺哪个，不把子进程的错误堆栈丢给用户。
function missingPluginFiles(pluginRoot) {
  const skill = skillRoot(pluginRoot);
  return Object.keys(PLUGIN_FILES).filter((name) => !fs.existsSync(path.join(skill, ...PLUGIN_FILES[name])));
}

function pluginFiles(pluginRoot) {
  const skill = skillRoot(pluginRoot);
  const out = {};
  for (const [name, parts] of Object.entries(PLUGIN_FILES)) out[name] = path.join(skill, ...parts);
  const missing = missingPluginFiles(pluginRoot);
  if (missing.length > 0) {
    throw new Error(
      "插件里缺少查询所需文件：" + missing.map((name) => path.relative(pluginRoot, out[name])).join("、")
    );
  }
  return out;
}

function runStep(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw new Error(label + " 起不来：" + result.error.message);
  if (result.status !== 0) {
    const detail = childOutputDetail(result, DETAIL_LIMITS.step);
    throw new Error(label + " 失败(exit=" + result.status + ")" + (detail ? "：" + detail : ""));
  }
  return result;
}

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  }
  catch (error) {
    throw new Error(label + " 读不到：" + file);
  }
  if (raw.includes("\uFFFD")) throw new Error(label + " 出现替换字符（编码损坏）：" + file);
  try {
    return JSON.parse(raw);
  }
  catch (error) {
    throw new Error(label + " 不是合法 JSON：" + error.message);
  }
}

// 从 MasterGo 取数并固化成快照；只落盘，响应内容不经过任何上下文。
function captureSnapshot(options, files, workDir) {
  const getDslPath = path.join(workDir, "getDsl.json");
  const mcpArgs = [
    files.mcpTool, "--tool", "getDsl",
    "--fileId", options.fileId, "--layerId", options.layerId,
    "--format", "json", "--out", getDslPath
  ];
  runStep(process.execPath, mcpArgs, "取 MasterGo DSL");
  runStep(options.pwsh, [
    "-NoProfile", "-File", files.capture,
    "-Action", "Capture", "-InputFile", getDslPath, "-Out", workDir,
    "-FileId", options.fileId, "-LayerId", options.layerId, "-Ui", options.ui
  ], "固化 DSL 快照");
  return path.join(workDir, "dsl.snapshot.json");
}

function absOf(node, x, y) {
  const style = node.layoutStyle || {};
  const absX = x + (typeof style.relativeX === "number" ? style.relativeX : 0);
  const absY = y + (typeof style.relativeY === "number" ? style.relativeY : 0);
  return { absX, absY, width: style.width, height: style.height };
}

// 快照里 Capture 已把节点 id 写成页内全路径 ref，ID 直接由插件公式派生。
function collectNodes(snapshot, pageNodeId, mappingByRef, pageXml) {
  const pageKey = pageNodeId.pageKeyOf(snapshot);
  const nodes = [];
  const walk = (node, x, y) => {
    const box = absOf(node, x, y);
    const ref = String(node.id);
    const mapped = mappingByRef.get(ref) || null;
    const text = Array.isArray(node.text) ? node.text.map((part) => part.text || "").join("") : "";
    nodes.push({
      ref: ref,
      id: pageNodeId.derivePageNodeId(pageKey, ref),
      layerId: ref.indexOf("/") >= 0 ? ref.slice(ref.lastIndexOf("/") + 1) : ref,
      name: node.name || "",
      text: text,
      type: node.type || "",
      pageAbsX: box.absX,
      pageAbsY: box.absY,
      width: typeof box.width === "number" ? box.width : null,
      height: typeof box.height === "number" ? box.height : null,
      template: mapped ? mapped.controlType + (mapped.attrs && mapped.attrs.Style ? " / " + mapped.attrs.Style : "") : "",
      controlType: mapped ? mapped.controlType : "",
      xml: mapped ? extractXmlChunk(pageXml, mapped.xmlId) : ""
    });
    for (const child of node.children || []) walk(child, box.absX, box.absY);
  };
  const root = snapshot && snapshot.dsl && Array.isArray(snapshot.dsl.nodes) ? snapshot.dsl.nodes[0] : null;
  if (!root) throw new Error("快照里没有根节点（期望 dsl.snapshot.json）");
  walk(root, 0, 0);
  return { pageKey: pageKey, nodes: nodes };
}

function runNodeControls(options) {
  const pluginRoot = path.resolve(options.pluginRoot);
  const workDir = path.resolve(options.workDir);
  fs.mkdirSync(workDir, { recursive: true });
  const outPath = path.resolve(options.outPath || path.join(workDir, "node-controls.json"));
  const files = pluginFiles(pluginRoot);
  const pageNodeId = require(files.pageNodeId);

  let snapshotPath = options.snapshot ? path.resolve(options.snapshot) : "";
  let source = "snapshot";
  if (!snapshotPath) {
    if (!options.fileId || !options.layerId) {
      throw new Error("用法：--snapshot <dsl.snapshot.json> 或 --file-id <id> --layer-id <79:162125>");
    }
    snapshotPath = captureSnapshot(options, files, workDir);
    source = "mastergo";
  }
  if (!fs.existsSync(snapshotPath)) throw new Error("快照不存在：" + snapshotPath);
  // 先读快照再动子步骤：坏快照要当场报「不是合法 JSON」，
  // 而不是先白跑一遍取数/映射再在别的脚本里炸出一句看不懂的错。
  const snapshot = readJson(snapshotPath, "DSL 快照");

  const visibilityPath = path.join(workDir, "visibility.json");
  runStep(process.execPath, [files.visibility, "--input", snapshotPath, "--out", visibilityPath], "解析显隐事实");
  const mappingPath = path.join(workDir, "mapping.json");
  runStep(process.execPath, [
    files.mapping, "--dsl", snapshotPath, "--visibility", visibilityPath,
    "--template-map", files.templateMap, "--out", mappingPath
  ], "推导 mapping");
  const pageXmlPath = path.join(workDir, "page.xml");
  runStep(process.execPath, [
    files.xml, "--fresh", mappingPath, "--out", pageXmlPath, "--map", files.templateMap
  ], "发射控件代码");

  const mapping = readJson(mappingPath, "mapping");
  const mappingByRef = new Map((mapping.nodes || []).map((node) => [node.sourceRef, node]));
  const collected = collectNodes(snapshot, pageNodeId, mappingByRef, fs.readFileSync(pageXmlPath, "utf8"));

  const payload = { pageKey: collected.pageKey, source: source, snapshot: snapshotPath, nodes: collected.nodes };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  if (!options.quiet) {
    console.log(JSON.stringify({
      out: outPath,
      pageKey: payload.pageKey,
      source: payload.source,
      nodes: payload.nodes.length,
      mappedNodes: payload.nodes.filter((node) => node.xml).length
    }, null, 2));
  }
  return payload;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  // 未知参数直接拒绝：静默忽略会让 `--plugins`（少打一个字母）变成「插件根没给」这种难查的失败。
  const known = new Set(["plugin", "out", "work-dir", "snapshot", "file-id", "layer-id", "ui", "pwsh", "quiet"]);
  const unknown = Object.keys(args).filter((key) => !known.has(key));
  if (unknown.length > 0) fail("无法识别的参数: " + unknown.map((key) => "--" + key).join("、"));
  try {
    runNodeControls({
      pluginRoot: args.plugin,
      outPath: args.out,
      workDir: args["work-dir"] || fs.mkdtempSync(path.join(require("os").tmpdir(), "node-control-")),
      snapshot: args.snapshot,
      fileId: args["file-id"],
      layerId: args["layer-id"],
      ui: args.ui || DEFAULT_UI,
      pwsh: args.pwsh || "pwsh",
      quiet: args.quiet === true
    });
  }
  catch (error) {
    fail(String(error && error.message ? error.message : error));
  }
}

if (require.main === module) main();

module.exports = { runNodeControls, missingPluginFiles };
