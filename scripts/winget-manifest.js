#!/usr/bin/env node
"use strict";

/*
 * 生成 winget 清单（portable 包）：客户机一条 `winget install BigStart.MasterGoTranscoder` 装好，
 * 不跑任何安装程序 —— winget 只是把 zip 下载、解压到它自己的包目录，再把 mastergo-transcoder.exe 链进 PATH。
 *
 * 用法：
 *   node scripts/winget-manifest.js                     # 用 dist/ 里这一版的 zip，基址＝内置 GitHub 仓库
 *   node scripts/winget-manifest.js --base https://git.公司.com/组/仓库 --kind gitlab     # 换成公司 GitLab
 *   node scripts/winget-manifest.js --base http://10.0.0.9/updates --kind static          # 内网静态目录
 *   node scripts/winget-manifest.js --base … --id BigStart.MasterGoTranscoder.Internal    # 内网那一份（标识分开）
 *   node scripts/winget-manifest.js --zip dist/xxx.zip --out dist/winget  # 指定包与输出目录
 *
 * 产物：dist/winget/ 下三个 YAML（version / locale / installer），可直接提 PR 到 winget-pkgs，
 * 也可放进内网目录用 `winget install --manifest <目录>`。
 *
 * 边界：版本号只认 package.json；InstallerUrl 只用「基址 + 这一版的 zip 名」；sha256 现算，
 * 不接受手填（包改了清单就得重生成，这是唯一正确的做法）。
 */

const fs = require("fs");
const path = require("path");

const { sha256File } = require("../lib/app-manifest.js");
const source = require("../lib/source.js");
const winget = require("../lib/winget-manifest.js");

const ROOT = path.join(__dirname, "..");

function argValue(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const version = pkg.version;
  /*
   * 默认基址与地址拼法都取 lib/source.js 那一处：清单里的包地址跟客户端自己下载用的是同一套规则。
   * 源类型也要跟着换 —— GitHub 的 release 路径与 GitLab 的通用包路径不是一种形状；
   * 类型不认识、或基址不合法，都要直说：normalizeSource 会回落成内置的公网源，
   * 回落了就变成「清单悄悄指到 GitHub」，比报错难查得多。
   */
  const kind = String(argValue("kind", "github"));
  if (!source.KINDS.includes(kind)) throw new Error("不认识的源类型：" + kind + "（可用：" + source.KINDS.join(" / ") + "）");
  const wantedBase = String(argValue("base", source.DEFAULT_BASE));
  // parseSource 不回落：类型认识、基址合法才给结果；否则宁可报错，也不要一份悄悄指到别处的清单。
  const normalized = source.parseSource({ kind: kind, base: wantedBase });
  if (!normalized) throw new Error("基址不合法（要 http/https）：" + wantedBase);
  const base = normalized.base;
  const id = String(argValue("id", winget.DEFAULT_ID));
  const folder = "mastergo-transcoder-gui-" + version;
  const zip = path.resolve(ROOT, argValue("zip", path.join("dist", folder + ".zip")));
  const outDir = path.resolve(ROOT, argValue("out", path.join("dist", "winget")));
  if (!fs.existsSync(zip)) {
    throw new Error("找不到这一版的 zip：" + zip + "（先跑 node scripts/pack-bundle.js）");
  }

  // 标识、版本、包地址、哈希、包内目录 —— 清单要说的就这五样。
  const facts = {
    id: id,
    version: version,
    url: source.assetUrl(normalized, version, folder + ".zip"),
    sha256: sha256File(zip).toUpperCase(),
    folder: folder
  };

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of winget.yamlFiles(facts)) fs.writeFileSync(path.join(outDir, file.name), file.body, "utf8");

  process.stdout.write("winget 清单（" + id + " · " + version + "）→ " + outDir + "\n");
  process.stdout.write("  包地址：" + facts.url + "\n");
  process.stdout.write("  sha256：" + facts.sha256 + "\n");
}

main();
