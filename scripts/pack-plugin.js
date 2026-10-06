#!/usr/bin/env node
"use strict";

/*
 * 打插件发布件：<插件名>-<版本>.zip + plugin-manifest.json。发布流程在打 tag 时调它。
 *
 * 用法：node scripts/pack-plugin.js --repo-dir <插件仓库的检出目录> [--out dist] [--pin plugin-pin.json]
 *       node scripts/pack-plugin.js --print-pin [--pin plugin-pin.json]   # 按行给出仓库与 tag，自己去检出
 * 产物按前缀写到标准输出（发布流程按前缀取，不猜行序）：`blob=<zip 路径>`、`manifest=<清单路径>`；
 * 说明写到标准错误。
 *
 * 内容用 git archive 从钉住的 tag 取：只含那次提交里的文件，条目时间取 commit 时间，
 * 同一个 tag 打出来哈希一致。命令在 plugins/ 目录下跑、路径按「相对当前目录」给 ——
 * 写成「tag:路径」时 git 会拿当前时间写进 zip，同一份内容每次哈希都不一样；
 * 加 --prefix 又会把路径再包一层，包里就不是「插件根直接作为顶层目录」了。
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
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const {
  PLUGIN_NAME,
  PLUGIN_MARKER,
  isPluginRoot,
  pluginVersionOf,
  MANIFEST_FILE,
  zipName,
  versionOfTag
} = require("../lib/plugin-package.js");

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
  const out = { repoDir: "", out: "dist", printPin: false, pin: DEFAULT_PIN };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--print-pin") {
      out.printPin = true;
      continue;
    }
    if (arg === "--pin") out.pin = String(argv[i + 1] || "");
    else if (arg === "--repo-dir") out.repoDir = String(argv[i + 1] || "");
    else if (arg === "--out") out.out = String(argv[i + 1] || "");
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

// 插件在仓库里的位置（plugin-pin.json 的 path）：git archive 要在它的上一级目录里跑，
// 路径按相对当前目录给。
function splitPluginDir(dir) {
  const parts = String(dir || "").split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("plugin-pin.json 的 path 要形如 plugins/<插件名>：" + dir);
  return { parent: parts.slice(0, -1).join("/"), name: parts[parts.length - 1] };
}

function pack(args, pin) {
  const repoDir = path.resolve(args.repoDir);
  if (!fs.existsSync(repoDir)) throw new Error("插件仓库的检出目录不存在：" + repoDir);
  const version = versionOfTag(pin.tag);
  if (!/^\d+(\.\d+)*$/.test(version)) throw new Error("钉住的插件版本不像版本号：" + pin.tag);
  const where = splitPluginDir(pin.dir);
  if (where.name !== PLUGIN_NAME) {
    throw new Error("pin 的 path 里那个目录要叫 " + PLUGIN_NAME + "（市场按这个名字认插件）：" + pin.dir);
  }
  /*
   * 要发布的是 tag 里的内容：先把它摊到一个临时目录，后面两道门禁（是不是插件根、版本是多少）
   * 都用客户端那一套目录判据，不再为 git 树另写一份；最后包也从同一个 tag 取。
   */
  const staging = path.join(os.tmpdir(), "mgtg-plugin-src-" + process.pid);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    const tarball = path.join(staging, "tree.tar");
    git(repoDir, ["archive", "--format=tar", pin.tag, pin.dir, "-o", tarball]);
    execFileSync("tar", ["-xf", tarball, "-C", staging], { windowsHide: true });
    const treeDir = path.join(staging, pin.dir);
    if (!isPluginRoot(treeDir)) {
      throw new Error("这个 tag 里没有 " + PLUGIN_MARKER + "，客户端认不出它是一份插件：" + pin.dir);
    }
    const declared = pluginVersionOf(treeDir);
    if (String(declared) !== version) {
      throw new Error(pin.tag + " 里的插件版本是 " + declared + "，与标签对不上。");
    }
    writePackage(args, pin, version, where);
  }
  finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function writePackage(args, pin, version, where) {
  const repoDir = path.resolve(args.repoDir);
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, zipName(version));
  fs.rmSync(zipPath, { force: true });
  // 在 path 的上一级目录里跑、路径用插件自己的目录名（见文件头：这样包顶层就是插件根，且哈希可复现）。
  // -o 的路径按 git 进程的工作目录算（-C 之后就是那个目录），所以这里给绝对路径。
  git(path.join(repoDir, where.parent), ["archive", "--format=zip", pin.tag, where.name, "-o", zipPath]);

  const manifest = {
    name: PLUGIN_NAME,
    version: version,
    tag: pin.tag,
    releasedAt: new Date().toISOString(),
    zip: {
      name: zipName(version),
      sha256: crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex")
    }
  };
  const manifestPath = path.join(outDir, MANIFEST_FILE);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  // 上传方要的是文件名，别在流程里再拼一遍（拼一遍就等于同一件事有两处实现）。
  process.stderr.write("插件包已生成：" + zipPath + "（" + manifest.version + "）\n");
  // 按名字报产物（上传方按前缀取，不去猜行序）：包在前，清单在后。
  process.stdout.write("blob=" + zipPath + "\n" + "manifest=" + manifestPath + "\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pin = readPin(path.resolve(args.pin));
  // 发布流程先问这一句「打的是哪个仓库、哪个 tag」，再自己去检出：pin 只在 plugin-pin.json 一处。
  if (args.printPin) {
    process.stdout.write(pin.repo + "\n" + pin.tag + "\n");
    return;
  }
  pack(args, pin);
}

main();
