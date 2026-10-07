#!/usr/bin/env node
"use strict";

/*
 * 生成内网 winget 源的数据目录：dist/winget-source/
 *   winget-source.json   源服务读这一份（包与版本的 REST 形状）
 *   files/<zip>          客户机装的时候从这里下 zip
 *
 * 用法：
 *   node scripts/winget-source.js --base https://<这台源服务的地址>
 *   node scripts/winget-source.js --base … --id BigStart.MasterGoTranscoder.Internal
 *   node scripts/winget-source.js --base … --zip dist/xxx.zip --out dist/winget-source
 *
 * 边界：base 是这台源服务自己的地址 —— 清单里的包地址＝<base>/files/<zip 名>，
 * 换服务地址就要重生成（地址写在数据里，服务不替它拼）。
 */

const fs = require("fs");
const path = require("path");

const source = require("../lib/source.js");
const { argValue } = require("./lib/args.js");
const winget = require("./lib/winget-manifest.js");
const { versionFacts } = require("./lib/winget-facts.js");

const ROOT = path.join(__dirname, "..");

function main() {
  const wantedBase = String(argValue("base", ""));
  // 基址合法性只认 lib/source.js 那一处判据：static 就是「一个 http(s) 基址」这一形态。
  const normalized = source.parseSource({ kind: "static", base: wantedBase });
  if (!normalized) throw new Error("基址不合法（要 http/https）：" + wantedBase);
  // 内网这一份的标识默认带 .Internal：同一台机器上两个同名包会打架。
  const id = String(argValue("id", winget.INTERNAL_ID));
  const outDir = path.resolve(ROOT, argValue("out", path.join("dist", "winget-source")));
  // 这一版的事实与三个 YAML 那份同源（lib 一处装配）；差别只在包地址指向这台源服务自己。
  const facts = versionFacts({
    id: id,
    zip: argValue("zip", ""),
    urlOf: (info) => normalized.base + "/" + winget.SOURCE_FILES_DIR + "/" + path.basename(info.zipPath)
  });

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, winget.SOURCE_FILES_DIR), { recursive: true });
  // 包里那份 zip 由这个服务自己发，所以它也要跟着数据一起落盘。
  fs.copyFileSync(facts.zipPath, path.join(outDir, winget.SOURCE_FILES_DIR, path.basename(facts.zipPath)));
  const document = winget.sourceDocument([winget.restPackage(facts)]);
  fs.writeFileSync(path.join(outDir, winget.SOURCE_FILE), JSON.stringify(document, null, 2) + "\n", "utf8");

  process.stdout.write("内网 winget 源数据（" + facts.id + " · " + facts.version + "）→ " + outDir + "\n");
  process.stdout.write("  数据文件：" + winget.SOURCE_FILE + "\n");
  process.stdout.write("  包地址：" + facts.url + "\n");
  process.stdout.write("  sha256：" + facts.sha256 + "\n");
  process.stdout.write("  把这一整个目录传到服务器上给源服务读（见 docs/winget-internal-source.md）。\n");
}

try {
  main();
}
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
