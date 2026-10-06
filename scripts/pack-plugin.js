#!/usr/bin/env node
"use strict";

/*
 * 打插件发布件：与客户端发布同一套协议 —— plugin-manifest.json（{version, files:{路径: sha256}}）
 * 加上按内容哈希命名的文件。发布流程在打 tag 时调它。
 *
 * 用法：node scripts/pack-plugin.js --repo-dir <插件仓库的检出目录> [--out dist] [--pin plugin-pin.json]
 *                                   [--upload <tag> [--notes <说明>]]
 *       node scripts/pack-plugin.js --print-pin [--pin plugin-pin.json]   # 报出 repo= / tag=，自己去检出
 *
 * 内容从钉住的 tag 取（git archive 摊成目录），逐文件算 sha256 写进清单；上传时先传文件、清单最后传。
 *
 * 版本以插件自己的清单（.claude-plugin/plugin.json）为准，
 * 与 tag 对不上就直接失败，不让「发布的版本」和「包里声明的版本」出现两说。
 *
 * 依赖：git（取 tag 内容）与系统 tar（把 tag 摊成目录，好让判据直接用客户端那一套）——
 * Windows 10+ 自带 tar，CI 的 ubuntu 也有；本机缺了就该报错，不猜。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
// 判据只有一处实现（lib/plugin-root.js）：这里直接用它的公开函数，不再另建一层转口。
const { PLUGIN_NAME, PLUGIN_MARKER, isPluginRoot, pluginVersionOf } = require("../lib/plugin-root.js");
const { listFilesUnder, hashFiles } = require("../lib/app-manifest.js");
const { PLUGIN_MANIFEST_NAME } = require("../lib/source.js");
const { isVersionName } = require("../lib/versions.js");
const { stageAssets, uploadRelease } = require("./lib/release-assets.js");

// 发布件的名字与客户端那一半共用 lib/source.js 里的定义（打包写什么名，客户端就找什么名）。
const MANIFEST_FILE = PLUGIN_MANIFEST_NAME;
const versionOfTag = function (tag) { return String(tag || "").trim().replace(/^v/, ""); };

// 打哪一版由 pin 文件决定（默认 plugin-pin.json，改它不用改代码）；它只属于发布流程，不进运行树。
const DEFAULT_PIN = path.join(__dirname, "..", "plugin-pin.json");

function usage(message) {
  if (message) process.stderr.write(message + "\n");
  process.stderr.write(
    "用法：node scripts/pack-plugin.js --repo-dir <插件仓库的检出目录> [--out dist]\n" +
    "      node scripts/pack-plugin.js --print-pin\n"
  );
  process.exit(2);
}

function parseArgs(argv) {
  const out = { repoDir: "", out: "dist", printPin: false, pin: DEFAULT_PIN, upload: "", notes: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--print-pin") {
      out.printPin = true;
      continue;
    }
    if (arg === "--pin") out.pin = String(argv[i + 1] || "");
    else if (arg === "--repo-dir") out.repoDir = String(argv[i + 1] || "");
    else if (arg === "--out") out.out = String(argv[i + 1] || "");
    else if (arg === "--upload") out.upload = String(argv[i + 1] || "");
    else if (arg === "--notes") out.notes = String(argv[i + 1] || "");
    else usage("认不出的参数：" + arg);
    i += 1;
  }
  if (!out.printPin && !out.repoDir) usage("要给 --repo-dir：插件仓库的检出目录。");
  return out;
}

function git(repoDir, args) {
  return execFileSync("git", ["-C", repoDir].concat(args), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readPin(pinPath) {
  const raw = JSON.parse(fs.readFileSync(pinPath, "utf8"));
  return {
    repo: String(raw.repo || "").trim().replace(/\/+$/, ""),
    tag: String(raw.tag || "").trim(),
    dir: String(raw.path || "").trim().replace(/^\/+|\/+$/g, "")
  };
}

/*
 * 插件在仓库里的位置（plugin-pin.json 的 path）只在这里解析一次：判据（这棵树是不是插件根）、
 * 打包（在它的上一级目录里跑 git archive）、报错信息全用它 —— 不会出现「门禁看一个目录、打包用另一个」。
 */
function pluginDirParts(dir) {
  const parts = String(dir || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("plugin-pin.json 的 path 要形如 plugins/<插件名>：" + dir);
  const name = parts[parts.length - 1];
  if (name !== PLUGIN_NAME) {
    throw new Error("pin 的 path 里那个目录要叫 " + PLUGIN_NAME + "（市场按这个名字认插件）：" + dir);
  }
  return { parts: parts };
}

function pack(args, pin) {
  const repoDir = path.resolve(args.repoDir);
  if (!fs.existsSync(repoDir)) throw new Error("插件仓库的检出目录不存在：" + repoDir);
  const version = versionOfTag(pin.tag);
  // 「什么算版本号」只有 lib/versions.js 一处（与客户端认版本目录同一口径）。
  if (!isVersionName(version)) throw new Error("钉住的插件版本不像版本号：" + pin.tag);
  const where = pluginDirParts(pin.dir);
  /*
   * 要发布的是 tag 里的内容：先把它摊到一个临时目录，后面两道门禁（是不是插件根、版本是多少）
   * 都用客户端那一套目录判据，不再为 git 树另写一份；最后包也从同一个 tag 取。
   */
  const staging = path.join(os.tmpdir(), "mgtg-plugin-src-" + process.pid);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    const tarball = path.join(staging, "tree.tar");
    git(repoDir, ["archive", "--format=tar", pin.tag, where.parts.join("/"), "-o", tarball]);
    execFileSync("tar", ["-xf", tarball, "-C", staging], { windowsHide: true });
    // 要发布的那棵树就是 pin 指的那一个：用定位那份的同一条判据（标记文件在不在）。
    const treeDir = path.join(staging, ...where.parts);
    if (!isPluginRoot(treeDir)) {
      throw new Error("这个 tag 里没有 " + PLUGIN_MARKER + "，客户端认不出它是一份插件：" + pin.dir);
    }
    const declared = pluginVersionOf(treeDir);
    if (String(declared) !== version) {
      throw new Error(pin.tag + " 里的插件版本是 " + declared + "，与标签对不上。");
    }
    writePackage(args, pin, version, treeDir);
  }
  finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function writePackage(args, pin, version, treeDir) {
  const outDir = path.resolve(args.out);
  // 扫树与算哈希都用 lib/app-manifest.js 那一份（/ 分隔、字典序；插件树不排除任何目录）。
  const files = hashFiles(treeDir, listFilesUnder(treeDir));
  const manifest = {
    name: PLUGIN_NAME,
    version: version,
    tag: pin.tag,
    releasedAt: new Date().toISOString(),
    files: files
  };
  const staged = stageAssets({ root: treeDir, manifest: manifest, outDir: outDir, manifestName: MANIFEST_FILE });
  process.stderr.write(
    "插件发布件：" + staged.fileCount + " 个文件（去重后 " + staged.uniqueCount + " 份）→ " + outDir + "\n"
  );
  if (args.upload) {
    uploadRelease({
      tag: args.upload,
      blobPaths: staged.blobPaths,
      manifestPath: staged.manifestPath,
      title: args.upload,
      notes: args.notes
    });
    process.stderr.write("已上传 " + args.upload + "（清单最后传）\n");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pin = readPin(path.resolve(args.pin));
  // 发布流程先问这一句「打的是哪个仓库、哪个 tag」，再自己去检出：pin 只在 plugin-pin.json 一处。
  if (args.printPin) {
    process.stdout.write("repo=" + pin.repo + "\n" + "tag=" + pin.tag + "\n");
    return;
  }
  pack(args, pin);
}

module.exports = { MANIFEST_FILE: MANIFEST_FILE, versionOfTag: versionOfTag };

if (require.main === module) main();
