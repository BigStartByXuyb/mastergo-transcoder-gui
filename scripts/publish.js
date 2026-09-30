#!/usr/bin/env node
"use strict";

/*
 * 发布：把当前仓库的运行树做成一份 GitHub Release 资产 —— manifest.json + files/<sha256>。
 *
 * 用法：
 *   node scripts/publish.js                      # 只产物化到 dist/update（先看清单对不对）
 *   node scripts/publish.js --upload             # 产物化并传到 GitHub Release（需要 gh 已登录）
 *   node scripts/publish.js --min-client 0.2.0   # 声明这版要求客户端外壳至少 v0.2.0
 *   node scripts/publish.js --no-fresh-run       # 声明这版不要求新开一次运行
 *
 * 边界：版本号只有一个来源（package.json）；前端没构建（public/index.html 不在）就拒绝发布。
 * 上传顺序：先传全部文件，最后才传 manifest.json —— 清单先到而文件没到，客户端会下到 404。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { buildManifest } = require("../lib/app-manifest.js");
const { notesOf, notesText } = require("../lib/changelog.js");

const ROOT = path.join(__dirname, "..");

function argValue(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(command + " 退出码 " + result.status);
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  if (!fs.existsSync(path.join(ROOT, "public", "index.html"))) {
    throw new Error("public/index.html 不在：先跑 npm run build:ui，再发布。");
  }
  const declared = argValue("version", pkg.version);
  if (declared !== pkg.version) {
    throw new Error("版本号只能来自 package.json：" + pkg.version + " ≠ " + declared);
  }

  const outDir = path.resolve(ROOT, argValue("out", path.join("dist", "update")));
  const filesDir = path.join(outDir, "files");
  const manifest = buildManifest(ROOT, pkg.version);
  manifest.releasedAt = new Date().toISOString();
  manifest.minClientVersion = argValue("min-client", "");
  manifest.freshRunRequired = process.argv.indexOf("--no-fresh-run") < 0;
  // 这一版改了什么跟着清单一起发：客户端检查更新时就能显示，不用再多打一次 GitHub API。
  manifest.notes = notesOf(ROOT, pkg.version);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(filesDir, { recursive: true });
  const written = new Map();
  for (const rel of Object.keys(manifest.files)) {
    const hash = manifest.files[rel];
    if (written.has(hash)) continue;
    fs.copyFileSync(path.join(ROOT, rel), path.join(filesDir, hash));
    written.set(hash, rel);
  }
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const unique = written.size;
  process.stdout.write(
    "v" + manifest.version + "：运行树 " + Object.keys(manifest.files).length + " 个文件，"
    + "内容去重后 " + unique + " 份，产物在 " + outDir + "\n"
  );

  if (process.argv.indexOf("--upload") < 0) return;
  const tag = "v" + manifest.version;
  const existing = spawnSync("gh", ["release", "view", tag], { encoding: "utf8", shell: process.platform === "win32" });
  const blobs = Array.from(written.keys()).map(function (hash) { return path.join(filesDir, hash); });
  if (existing.status === 0) {
    run("gh", ["release", "upload", tag].concat(blobs, ["--clobber"]));
  }
  else {
    const notes = notesText(ROOT, pkg.version) || "MasterGo 转码客户端 " + tag;
    run("gh", ["release", "create", tag, "--title", tag, "--notes", notes].concat(blobs));
  }
  run("gh", ["release", "upload", tag, path.join(outDir, "manifest.json"), "--clobber"]);
  process.stdout.write("已上传 " + tag + "（manifest.json 最后传）\n");
}

main();
