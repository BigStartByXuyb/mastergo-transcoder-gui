"use strict";

/*
 * 任务工作目录（方案 B：一个任务一份工程目录，跑完再合并回主工程）。
 *
 * 为什么必须隔离：同一个工程目录里有三处是全工程共享的，两条流水线同时跑一定互相破坏 ——
 *   Resources/Layout/Layout.xml   插件在 bundle 步读 → 插本页 <Page> → 写回
 *   <Project>.csproj              bundle 步读 → 补 <Content Include> → 写回
 *   Generated/_work/steps/*.log   路径里没有 Target，两条流水线互相覆盖
 * 其余产物路径都带 <Target>，本来就不冲突。
 *
 * 目录布局（都在 workRoot 下，避开主工程，避免被 SVN/Git 看见）：
 *   <workRoot>/<taskId>/        任务自己的工程目录（过滤复制）
 *   <workRoot>/<taskId>.base/   项目级文件的基线副本（三方合并的 base 一侧要内容，不只是哈希）
 *   <workRoot>/<taskId>.json    基线清单 { projectRoot, createdAt, files: { 相对路径 → sha256 } }
 *
 * 复制规则：跳过版本库元数据、编译产物和 Generated（产物按运行重建，不搬旧账）。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const fsp = fs.promises;

const SKIP_NAMES = new Set([".svn", ".git", ".hg", "node_modules", "bin", "obj", ".vs", "Backup", ".backup"]);
const SKIP_TOP = new Set(["Generated"]);

const LAYOUT_REL = "Resources/Layout/Layout.xml";

function toRel(value) {
  return value.split(path.sep).join("/");
}

function absolute(root, rel) {
  return path.join(root, ...rel.split("/"));
}

// 项目级共享文件：两边都改过时不能用「整份覆盖」，必须走行级三方合并。
function isProjectLevel(rel) {
  if (rel === LAYOUT_REL) return true;
  if (/\.csproj$/i.test(rel)) return true;
  return rel === "framework.config.json";
}

// 运行工作文件与覆盖备份：属于工作目录自己的账，不回写主工程。
function isScratch(rel) {
  return rel === "Generated/_work" || rel.startsWith("Generated/_work/");
}

function isBackup(rel) {
  return /\.bak-\d{8,}/.test(path.posix.basename(rel));
}

function shouldCopy(source, root) {
  const rel = path.relative(root, source);
  if (!rel) return true;
  const parts = rel.split(path.sep);
  if (parts.some((part) => SKIP_NAMES.has(part))) return false;
  return !SKIP_TOP.has(parts[0]);
}

function hashFile(file) {
  return new Promise(function (resolve, reject) {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on("data", function (chunk) { hash.update(chunk); });
    stream.on("error", reject);
    stream.on("end", function () { resolve(hash.digest("hex")); });
  });
}

async function walk(dir, out) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_NAMES.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), out);
      continue;
    }
    if (entry.isFile()) out.push(path.join(dir, entry.name));
  }
  return out;
}

async function readFileInfo(file) {
  try {
    const buffer = await fsp.readFile(file);
    return { text: buffer.toString("utf8"), hash: crypto.createHash("sha256").update(buffer).digest("hex") };
  }
  catch {
    return null;
  }
}

function paths(taskId, workRoot) {
  const root = path.resolve(workRoot);
  return {
    root: root,
    dir: path.join(root, taskId),
    baseDir: path.join(root, taskId + ".base"),
    manifestPath: path.join(root, taskId + ".json")
  };
}

/*
 * 建工作目录：过滤复制主工程 → 逐文件算基线哈希 → 项目级文件另存一份基线内容。
 * 返回的是这个任务以后一切操作的根（流水线的 -ProjectRoot 就是它）。
 */
async function create(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const taskId = String(options.taskId || "");
  if (!taskId) throw new Error("建工作目录缺少 taskId");
  if (!fs.existsSync(projectRoot)) throw new Error("工程目录不存在：" + projectRoot);

  const spot = paths(taskId, options.workRoot);
  await fsp.rm(spot.dir, { recursive: true, force: true });
  await fsp.rm(spot.baseDir, { recursive: true, force: true });
  await fsp.mkdir(spot.root, { recursive: true });
  await fsp.cp(projectRoot, spot.dir, {
    recursive: true,
    filter: function (source) { return shouldCopy(source, projectRoot); }
  });

  const files = {};
  const all = await walk(spot.dir, []);
  for (const file of all) {
    files[toRel(path.relative(spot.dir, file))] = await hashFile(file);
  }

  const projectFiles = Object.keys(files).filter(isProjectLevel);
  for (const rel of projectFiles) {
    const target = absolute(spot.baseDir, rel);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(absolute(spot.dir, rel), target);
  }

  const manifest = {
    projectRoot: projectRoot,
    taskId: taskId,
    createdAt: new Date().toISOString(),
    files: files
  };
  await fsp.writeFile(spot.manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return {
    dir: spot.dir,
    baseDir: spot.baseDir,
    manifestPath: spot.manifestPath,
    fileCount: all.length,
    projectFiles: projectFiles
  };
}

async function readManifest(taskId, workRoot) {
  const spot = paths(taskId, workRoot);
  try {
    return JSON.parse(await fsp.readFile(spot.manifestPath, "utf8"));
  }
  catch {
    return null;
  }
}

async function changed(workDir, manifest) {
  const files = await walk(workDir, []);
  const added = [];
  const modified = [];
  const seen = new Set();
  for (const file of files) {
    const rel = toRel(path.relative(workDir, file));
    seen.add(rel);
    const hash = await hashFile(file);
    if (manifest.files[rel] === undefined) added.push({ path: rel, hash: hash });
    else if (manifest.files[rel] !== hash) modified.push({ path: rel, hash: hash, baseHash: manifest.files[rel] });
  }
  const removed = Object.keys(manifest.files).filter(function (rel) { return !seen.has(rel); });
  return { added: added, modified: modified, removed: removed };
}

async function remove(taskId, workRoot) {
  const spot = paths(taskId, workRoot);
  await fsp.rm(spot.dir, { recursive: true, force: true });
  await fsp.rm(spot.baseDir, { recursive: true, force: true });
  await fsp.rm(spot.manifestPath, { force: true });
}

module.exports = {
  create,
  readManifest,
  changed,
  remove,
  absolute,
  readFileInfo,
  isProjectLevel,
  isScratch,
  isBackup,
  LAYOUT_REL
};
