#!/usr/bin/env node
"use strict";

/*
 * 「解压即用」包：把运行树按清单拷成一个目录，附一页安装说明，再压成 zip。
 *
 * 用法：node scripts/pack-bundle.js [--out dist] [--version <版本>]
 * 产物：<out>/mastergo-transcoder-gui-<版本>.zip
 *
 * 边界：文件清单只有一处来源（lib/app-manifest.js 的运行树），与客户端更新用的是同一份；
 * 本机没有 zip 命令时只铺目录、不压缩（打印一句说明），CI 上的 ubuntu 自带 zip。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { buildManifest, sha256File } = require("../lib/app-manifest.js");

const ROOT = path.join(__dirname, "..");

function argValue(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const version = argValue("version", pkg.version);
  const outDir = path.resolve(ROOT, argValue("out", "dist"));
  const folder = "mastergo-transcoder-gui-" + version;
  const stage = path.join(outDir, folder);

  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  const manifest = buildManifest(ROOT, version);
  for (const rel of Object.keys(manifest.files)) {
    const to = path.join(stage, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), to);
  }
  // 安装说明跟着包走：拿到包的人不用再回仓库找。
  const guide = path.join(ROOT, "docs", "install.md");
  if (fs.existsSync(guide)) fs.copyFileSync(guide, path.join(stage, "安装与首次配置.md"));

  process.stdout.write("已铺好 " + Object.keys(manifest.files).length + " 个文件 → " + stage + "\n");

  const zipFile = path.join(outDir, folder + ".zip");
  fs.rmSync(zipFile, { force: true });
  // zip 优先（CI 的 ubuntu 自带）；Windows 上退回 bsdtar 的 -a（按扩展名自动选 zip）。
  const attempts = [
    ["zip", ["-qr", zipFile, folder]],
    ["tar", ["-a", "-cf", zipFile, folder]]
  ];
  const done = attempts.some(function (attempt) {
    const result = spawnSync(attempt[0], attempt[1], { cwd: outDir, stdio: "inherit" });
    return result.status === 0 && fs.existsSync(zipFile);
  });
  if (!done) {
    process.stdout.write("本机没有 zip / tar，只铺了目录：" + stage + "\n");
    return;
  }
  /*
   * 顺带产一份 checksums.json：安装脚本（scripts/install-client.ps1）按它校验下载到的 zip。
   * 以前那份脚本是拿正则去啃 winget 清单的，等于把「安装脚本」和「winget 产物」绑成一个隐式契约 ——
   * 这里给一份专门给安装用的文件，两个产物各管各的。
   */
  fs.writeFileSync(path.join(outDir, "checksums.json"), JSON.stringify({
    version: version,
    zip: { name: folder + ".zip", sha256: sha256File(zipFile) }
  }, null, 2) + "\n", "utf8");
  process.stdout.write("打包完成：" + zipFile + "\n");
}

main();
