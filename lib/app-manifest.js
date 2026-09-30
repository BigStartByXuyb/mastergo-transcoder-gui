"use strict";

/*
 * 运行树清单：算清「跑起来需要哪些文件、每个文件的 sha256」。
 *
 * 谁在用：
 *   lib/update.js        差分更新 —— 本地清单和远端清单逐文件比，只下不一致的
 *   scripts/publish.js   发布 —— 生成 release 上的 manifest.json 与内容寻址的文件
 *
 * 边界：只认运行期文件，不含 ui 源码、测试、文档，也不含用户状态
 * （local.json、credentials、board.json、work/、versions/、blobs/）。
 * 清单里的路径一律用 / 分隔且已排序，两端算法只有这一份实现。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// 运行期顶层文件与目录：新版本要能脱离仓库源码独立跑起来，所以依赖也在这里面（vendor/）。
// scripts/ 是发布工具，不进运行树；launch.js 是入口（按 current.json 选版本），必须在。
// changelog.json 跟运行树一起走：更新后界面要能显示「这一版改了什么」，断网也得看得到。
const RUNTIME_FILES = ["server.js", "launch.js", "package.json", "start.cmd", "changelog.json"];
const RUNTIME_DIRS = ["lib", "public", "vendor"];

function toPosix(rel) {
  return rel.split(path.sep).join("/");
}

function walk(absDir, relDir, out) {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    const rel = relDir ? relDir + "/" + entry.name : entry.name;
    if (entry.isDirectory()) walk(abs, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
}

// 运行树里全部文件的相对路径（/ 分隔，字典序）。
function listRuntimeFiles(root) {
  const files = [];
  for (const name of RUNTIME_FILES) {
    if (fs.existsSync(path.join(root, name))) files.push(name);
  }
  for (const dir of RUNTIME_DIRS) {
    const abs = path.join(root, dir);
    if (fs.existsSync(abs)) walk(abs, dir, files);
  }
  return files.sort();
}

function sha256File(abs) {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

// 整棵运行树的清单：{ version, files: { 相对路径: sha256 } }
function buildManifest(root, version) {
  const files = {};
  for (const rel of listRuntimeFiles(root)) {
    files[rel] = sha256File(path.join(root, rel));
  }
  return { version: String(version || ""), files: files };
}

// 逐文件比：changed = 内容不同或本地缺；removed = 远端已经没有这份文件了。
function diffManifests(local, remote) {
  const localFiles = (local && local.files) || {};
  const remoteFiles = (remote && remote.files) || {};
  const changed = [];
  const removed = [];
  for (const rel of Object.keys(remoteFiles).sort()) {
    if (localFiles[rel] !== remoteFiles[rel]) changed.push(rel);
  }
  for (const rel of Object.keys(localFiles).sort()) {
    if (!(rel in remoteFiles)) removed.push(rel);
  }
  return { changed: changed, removed: removed, total: Object.keys(remoteFiles).length };
}

// 把相对路径落成运行目录里的绝对路径；越界的（..、绝对路径）直接拒。
function safeJoin(root, rel) {
  const abs = path.resolve(root, rel);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error("清单里的路径跑到运行目录外：" + rel);
  }
  return abs;
}

module.exports = { listRuntimeFiles, sha256File, buildManifest, diffManifests, safeJoin, toPosix };
