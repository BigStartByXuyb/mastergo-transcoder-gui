#!/usr/bin/env node
"use strict";

/*
 * 打插件发布件：<插件名>-<版本>.zip + plugin-manifest.json。发布流程在打 tag 时调它。
 *
 * 用法：node scripts/pack-plugin.js --repo-dir <插件仓库的检出目录> [--out dist]
 *
 * 内容用 git archive 从钉住的 tag 取：只含那次提交里的文件，条目时间取 commit 时间，
 * 同一个 tag 打出来哈希一致。命令在 plugins/ 目录下跑、路径按「相对当前目录」给 ——
 * 写成「tag:路径」时 git 会拿当前时间写进 zip，同一份内容每次哈希都不一样；
 * 加 --prefix 又会把路径再包一层，包里就不是「插件根直接作为顶层目录」了。
 *
 * 版本以插件自己的清单（.claude-plugin/plugin.json）为准，
 * 与 tag 对不上就直接失败，不让「发布的版本」和「包里声明的版本」出现两说。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { PLUGIN_NAME, PLUGIN_TAG, MANIFEST_FILE, zipName } = require("../lib/plugin-package.js");

const PLUGIN_DIR = "plugins/" + PLUGIN_NAME;

function usage(message) {
  if (message) process.stderr.write(message + "\n");
  process.stderr.write("用法：node scripts/pack-plugin.js --repo-dir <插件仓库的检出目录> [--out dist]\n");
  process.exit(2);
}

function parseArgs(argv) {
  const out = { repoDir: "", out: "dist" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo-dir") out.repoDir = String(argv[i + 1] || "");
    else if (arg === "--out") out.out = String(argv[i + 1] || "");
    else usage("认不出的参数：" + arg);
    i += 1;
  }
  if (!out.repoDir) usage("要给 --repo-dir：插件仓库的检出目录。");
  return out;
}

function git(repoDir, args) {
  return execFileSync("git", ["-C", repoDir].concat(args), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function versionOfTag(tag) {
  return String(tag || "").trim().replace(/^v/, "");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoDir = path.resolve(args.repoDir);
  if (!fs.existsSync(repoDir)) throw new Error("插件仓库的检出目录不存在：" + repoDir);
  const version = versionOfTag(PLUGIN_TAG);
  if (!/^\d+(\.\d+)*$/.test(version)) throw new Error("钉住的插件版本不像版本号：" + PLUGIN_TAG);

  // 版本以插件自己的清单为准：tag 与它不一致时宁可打不出包。
  const declared = JSON.parse(git(repoDir, ["show", PLUGIN_TAG + ":" + PLUGIN_DIR + "/.claude-plugin/plugin.json"])).version;
  if (String(declared) !== version) {
    throw new Error(PLUGIN_TAG + " 里的插件版本是 " + declared + "，与标签对不上。");
  }

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, zipName(version));
  fs.rmSync(zipPath, { force: true });
  // 在 plugins/ 下跑、路径用插件自己的目录名（见文件头：这样包顶层就是插件根，且哈希可复现）。
  // -o 的路径按 git 进程的工作目录算（-C 之后就是那个目录），所以这里给绝对路径。
  git(path.join(repoDir, "plugins"), ["archive", "--format=zip", PLUGIN_TAG, PLUGIN_NAME, "-o", zipPath]);

  const manifest = {
    name: PLUGIN_NAME,
    version: version,
    tag: PLUGIN_TAG,
    releasedAt: new Date().toISOString(),
    zip: {
      name: zipName(version),
      sha256: crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex")
    }
  };
  fs.writeFileSync(path.join(outDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
  process.stdout.write("插件包已生成：" + path.join(outDir, manifest.zip.name) + "（" + manifest.version + "）\n");
}

main();
