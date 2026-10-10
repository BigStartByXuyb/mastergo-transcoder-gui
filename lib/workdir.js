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
 *   <workRoot>/staged/          先选好的设计稿位图还没落地时的暂存件（名字见 lib/design-image.js）
 *
 * 复制规则：只跳过版本库元数据与编译产物，其余原样复制 —— 工作目录必须和插件单独跑时看到的主工程
 * 一模一样。`Generated/_inputs` 里的命名表/译文/术语是本次运行的**输入**：少了它，插件会退回去
 * 重新「待命名」，让人/AI 再猜一遍，猜出来的键名和上一版不同就覆盖掉已确认的产物。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const fsp = fs.promises;

const SKIP_NAMES = new Set([".svn", ".git", ".hg", "node_modules", "bin", "obj", ".vs", "Backup", ".backup"]);

// 运行产物所在的顶层目录：建工作目录时照常复制，合并时由本次运行覆盖。
const RUN_PRODUCT_TOP = "Generated";

const LAYOUT_REL = "Resources/Layout/Layout.xml";

function toRel(value) {
  return value.split(path.sep).join("/");
}

function absolute(root, rel) {
  return path.join(root, ...rel.split("/"));
}

// 运行产物目录下的相对路径（例：runProductRel("_inputs") → "Generated/_inputs"）。
// 顶层目录名只有 RUN_PRODUCT_TOP 一处定义，别的地方不许再写 "Generated"。
function runProductRel(...parts) {
  return [RUN_PRODUCT_TOP].concat(parts).join("/");
}

/*
 * 运行产物里那几处有约定的目录：产物顶层、输入（人/AI 给的图、表）、每次运行的登记与快照。
 * 这几段的拼法只在这几个具名函数里定义，消费的一方读它们，不再各自拼字符串
 * （拼两份的事实来源，插件口径一变就会出一处对、一处错，而且错的那一处往往静默读空）。
 */
function productDir(projectRoot) {
  return absolute(projectRoot, runProductRel());
}

function inputsDir(projectRoot) {
  return absolute(projectRoot, runProductRel("_inputs"));
}

function runsRoot(projectRoot) {
  return absolute(projectRoot, runProductRel("runs"));
}

function runsDir(projectRoot, target) {
  return absolute(projectRoot, runProductRel("runs", String(target)));
}

// 插件接口文件名（与插件约定的路径拼法只有这一处）：
//   分组表 Generated/_inputs/<Target>.layout-groups.json
//   快照  Generated/runs/<Target>/dsl.snapshot.json
//   类型判定 Generated/<Target>.component-types.json
function layoutGroupsPath(projectRoot, target) {
  return path.join(inputsDir(projectRoot), String(target).trim() + ".layout-groups.json");
}

function snapshotPath(projectRoot, target) {
  return path.join(runsDir(projectRoot, target), "dsl.snapshot.json");
}

function componentTypesPath(projectRoot, target) {
  return path.join(productDir(projectRoot), String(target).trim() + ".component-types.json");
}

// 容错读 JSON：文件不存在 / 内容不是合法 JSON 时回 null。多模块都要「读产物看状态」，只在这里一份。
function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/*
 * 读分组表：文件不在、解析不出、或 groups 不是数组 → null；空数组是合法声明，照原样返回。
 * 「这一页有没有分组表」＝**这次读得出来**（`!== null`）—— 判据只在这一个函数里定，别处只做这个空值判断，
 * 不另写一套「文件在不在 / 数组空不空」。
 *
 * 判据比插件的「表在不在」（run-all.ps1 的 Test-Path）严一档：**损坏的表按「没有表」处理**。
 * 那种文件喂给插件的推导入口只会当场失败（校验 fail-closed），界面更应该把这一页列出来让人确认一次 ——
 * 写回之后表就是好的，停点随之解开。空数组不属于损坏：那是「本页没有要声明的分组」，就是可用的表。
 */
function readLayoutGroups(projectRoot, target) {
  const doc = readJsonIfExists(layoutGroupsPath(projectRoot, target));
  return doc && Array.isArray(doc.groups) ? doc : null;
}

// 项目级共享文件：两边都改过时不能用「整份覆盖」，必须走行级三方合并。
function isProjectLevel(rel) {
  if (rel === LAYOUT_REL) return true;
  if (/\.csproj$/i.test(rel)) return true;
  return rel === "framework.config.json";
}

// 运行工作文件与覆盖备份：属于工作目录自己的账，不回写主工程。
function isScratch(rel) {
  const scratch = RUN_PRODUCT_TOP + "/_work";
  return rel === scratch || rel.startsWith(scratch + "/");
}

/*
 * 运行产物：Generated/ 下的快照、运行登记表、汇总、审计、映射、图标台账、Bundle 清单与报告。
 * 合并时按「本次运行说了算」覆盖主工程里上一次那一份 —— 与插件单独跑同一条口径。
 */
function isRunProduct(rel) {
  return rel === RUN_PRODUCT_TOP || rel.startsWith(RUN_PRODUCT_TOP + "/");
}

function isBackup(rel) {
  return /\.bak-\d{8,}/.test(path.posix.basename(rel));
}

function shouldCopy(source, root) {
  const rel = path.relative(root, source);
  if (!rel) return true;
  const parts = rel.split(path.sep);
  if (parts.some((part) => SKIP_NAMES.has(part))) return false;
  return true;
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
 * 运行目录：安装根下的 work/。它就是上面那套布局的 workRoot，名字只有这一处 ——
 * 建工作目录（lib/board.js）与暂存件（lib/design-image.js）都从这儿取，不各写一遍。
 */
function workRootOf(home) {
  return path.join(path.resolve(String(home)), "work");
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
  workRootOf,
  readManifest,
  changed,
  remove,
  absolute,
  runProductRel,
  productDir,
  inputsDir,
  runsRoot,
  runsDir,
  layoutGroupsPath,
  snapshotPath,
  componentTypesPath,
  readLayoutGroups,
  readJsonIfExists,
  readFileInfo,
  isProjectLevel,
  isScratch,
  isRunProduct,
  isBackup,
  LAYOUT_REL
};
