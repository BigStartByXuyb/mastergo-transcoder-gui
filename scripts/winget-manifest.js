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

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const source = require("../lib/source.js");

const ROOT = path.join(__dirname, "..");
// 公网那份的标识；内网那份用 --id 换一个（同一台机器上两个同名包会打架）。
const IDENTIFIER = "BigStart.MasterGoTranscoder";
const PACKAGE_NAME = "MasterGo 转码客户端";
const PUBLISHER = "BigStart";
const SHORT_DESCRIPTION = "MasterGo 设计稿转码客户端：看板跑流水线、待确认、更新与回退";
// 内部工具：清单里必须有一项 License。这里按「公司内部使用」写，改发布策略时改这一处。
const LICENSE = "Proprietary";

function argValue(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function yamlInstaller(context) {
  return [
    "# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.6.0.schema.json",
    "PackageIdentifier: " + context.id,
    "PackageVersion: " + context.version,
    "InstallerType: zip",
    "NestedInstallerType: portable",
    "NestedInstallerFiles:",
    "  - RelativeFilePath: " + context.relativeExe,
    "    PortableCommandAlias: mastergo-transcoder",
    "Installers:",
    "  - Architecture: x64",
    "    InstallerUrl: " + context.url,
    "    InstallerSha256: " + context.sha256,
    "ManifestType: installer",
    "ManifestVersion: 1.6.0",
    ""
  ].join("\n");
}

function yamlLocale(context) {
  return [
    "# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.6.0.schema.json",
    "PackageIdentifier: " + context.id,
    "PackageVersion: " + context.version,
    "PackageLocale: zh-CN",
    "Publisher: " + PUBLISHER,
    "PackageName: " + PACKAGE_NAME,
    "ShortDescription: " + SHORT_DESCRIPTION,
    "License: " + LICENSE,
    "Moniker: mastergo-transcoder",
    "ManifestType: defaultLocale",
    "ManifestVersion: 1.6.0",
    ""
  ].join("\n");
}

function yamlVersion(context) {
  return [
    "# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.6.0.schema.json",
    "PackageIdentifier: " + context.id,
    "PackageVersion: " + context.version,
    "DefaultLocale: zh-CN",
    "ManifestType: version",
    "ManifestVersion: 1.6.0",
    ""
  ].join("\n");
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
  const id = String(argValue("id", IDENTIFIER));
  const folder = "mastergo-transcoder-gui-" + version;
  const zip = path.resolve(ROOT, argValue("zip", path.join("dist", folder + ".zip")));
  const outDir = path.resolve(ROOT, argValue("out", path.join("dist", "winget")));
  if (!fs.existsSync(zip)) {
    throw new Error("找不到这一版的 zip：" + zip + "（先跑 node scripts/pack-bundle.js）");
  }

  const context = {
    id: id,
    version: version,
    url: source.assetUrl(normalized, version, folder + ".zip"),
    sha256: sha256File(zip).toUpperCase(),
    // zip 里保留着那一层目录，所以相对路径要带上它。
    relativeExe: folder + "/mastergo-transcoder.exe"
  };

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const files = [
    [id + ".yaml", yamlVersion(context)],
    [id + ".locale.zh-CN.yaml", yamlLocale(context)],
    [id + ".installer.yaml", yamlInstaller(context)]
  ];
  for (const [name, body] of files) fs.writeFileSync(path.join(outDir, name), body, "utf8");

  process.stdout.write("winget 清单（" + id + " · " + version + "）→ " + outDir + "\n");
  process.stdout.write("  包地址：" + context.url + "\n");
  process.stdout.write("  sha256：" + context.sha256 + "\n");
  process.stdout.write("  入口：" + context.relativeExe + "（命令别名 mastergo-transcoder）\n");
}

main();
