#!/usr/bin/env node
"use strict";

/*
 * 打插件发布件：与客户端发布同一套协议 —— plugin-manifest.json（{name, version, tag, files:{路径: sha256}}）
 * 加上按内容哈希命名的文件。
 *
 * 谁在调它：插件仓库打 tag 时的那条发布作业（.github/workflows/plugin-release.yml）——
 * 插件有自己的版本线：版本 = 插件仓库的 tag，发布件发在插件仓库自己的 Release 上，客户端只消费。
 * 客户端本体发布不打插件、也不钉插件版本：插件自己说自己的版本。
 *
 * 用法：node scripts/pack-plugin.js --repo-dir <插件仓库的检出目录> --tag v1.0.377 \
 *                                   --dir plugins/mastergo-wpf-transcoder --out <发布件目录> \
 *                                   [--upload v1.0.377 [--notes <说明>]]
 *
 * 内容从那个 tag 取（git archive 摊成目录），逐文件算 sha256 写进清单；上传时先传文件、清单最后传。
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

function usage(message) {
  if (message) process.stderr.write(message + "\n");
  process.stderr.write(
    "用法：node scripts/pack-plugin.js --repo-dir <插件仓库的检出目录> --tag <tag> --dir <插件目录>\n" +
    "      --out <发布件目录> [--upload <tag> --notes <说明>]\n"
  );
  process.exit(2);
}

/*
 * 取参数值：给不出值就直接回绝 —— --out 这类路径参数拿到空串会变成「当前目录」，
 * 而打包那一步会先删掉输出目录。取值只有这一处，六个分支不再各写一遍 `|| ""`。
 */
function valueOf(argv, index, flag) {
  const value = argv[index + 1];
  if (typeof value === "undefined" || value === "" || value.startsWith("--")) {
    usage("要给 " + flag + " 一个值（现在是：" + (typeof value === "undefined" ? "没给" : value) + "）。");
  }
  return value;
}

function parseArgs(argv) {
  const out = { repoDir: "", tag: "", dir: "", out: "", upload: "", notes: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo-dir") out.repoDir = valueOf(argv, i, arg);
    else if (arg === "--tag") out.tag = valueOf(argv, i, arg).trim();
    else if (arg === "--dir") out.dir = valueOf(argv, i, arg).trim();
    else if (arg === "--out") out.out = valueOf(argv, i, arg);
    else if (arg === "--upload") out.upload = valueOf(argv, i, arg);
    else if (arg === "--notes") out.notes = valueOf(argv, i, arg);
    else usage("认不出的参数：" + arg);
    i += 1;
  }
  if (!out.repoDir) usage("要给 --repo-dir：插件仓库的检出目录。");
  if (!out.tag) usage("要给 --tag：插件仓库里的那个 tag（版本号从它取）。");
  if (!out.dir) usage("要给 --dir：那个 tag 里插件所在的目录（形如 plugins/<插件名>）。");
  // 输出目录必给：打包前会先删掉它，省略就落到一个默认目录上，删错地方比多打一个参数难查得多。
  if (!out.out) usage("要给 --out：发布件落到哪个目录（打包前会先清空它）。");
  return out;
}

function git(repoDir, args) {
  return execFileSync("git", ["-C", repoDir].concat(args), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/*
 * 插件在仓库里的位置（--dir）只在这里解析一次：判据（这棵树是不是插件根）、
 * 打包（在它的上一级目录里跑 git archive）、报错信息全用它 —— 不会出现「门禁看一个目录、打包用另一个」。
 */
function pluginDirParts(dir) {
  const parts = String(dir || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("--dir 要形如 plugins/<插件名>：" + dir);
  const name = parts[parts.length - 1];
  if (name !== PLUGIN_NAME) {
    throw new Error("--dir 里那个目录要叫 " + PLUGIN_NAME + "（市场按这个名字认插件）：" + dir);
  }
  return { parts: parts };
}

function pack(args) {
  const repoDir = path.resolve(args.repoDir);
  if (!fs.existsSync(repoDir)) throw new Error("插件仓库的检出目录不存在：" + repoDir);
  const version = versionOfTag(args.tag);
  // 「什么算版本号」只有 lib/versions.js 一处（与客户端认版本目录同一口径）。
  if (!isVersionName(version)) throw new Error("这个 tag 不像版本号：" + args.tag);
  const where = pluginDirParts(args.dir);
  /*
   * 要发布的是 tag 里的内容：先把它摊到一个临时目录，后面两道门禁（是不是插件根、版本是多少）
   * 都用客户端那一套目录判据，不再为 git 树另写一份；最后包也从同一个 tag 取。
   */
  const staging = path.join(os.tmpdir(), "mgtg-plugin-src-" + process.pid);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    const tarball = path.join(staging, "tree.tar");
    git(repoDir, ["archive", "--format=tar", args.tag, where.parts.join("/"), "-o", tarball]);
    execFileSync("tar", ["-xf", tarball, "-C", staging], { windowsHide: true });
    // 要发布的那棵树就是 --dir 指的那一个：用定位那份的同一条判据（标记文件在不在）。
    const treeDir = path.join(staging, ...where.parts);
    if (!isPluginRoot(treeDir)) {
      throw new Error("这个 tag 里没有 " + PLUGIN_MARKER + "，客户端认不出它是一份插件：" + args.dir);
    }
    const declared = pluginVersionOf(treeDir);
    if (String(declared) !== version) {
      throw new Error(args.tag + " 里的插件版本是 " + declared + "，与标签对不上。");
    }
    writePackage(args, version, treeDir);
  }
  finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function writePackage(args, version, treeDir) {
  const outDir = path.resolve(args.out);
  // 扫树与算哈希都用 lib/app-manifest.js 那一份（/ 分隔、字典序；插件树不排除任何目录）。
  const files = hashFiles(treeDir, listFilesUnder(treeDir));
  const manifest = {
    name: PLUGIN_NAME,
    version: version,
    tag: args.tag,
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
  pack(args);
}

module.exports = { MANIFEST_FILE: MANIFEST_FILE, versionOfTag: versionOfTag };

if (require.main === module) main();
