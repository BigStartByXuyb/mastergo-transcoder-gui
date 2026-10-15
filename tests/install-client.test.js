#!/usr/bin/env node
"use strict";

/*
 * 安装脚本（scripts/install-client.ps1）的硬约束：
 *   ① 它的默认基址必须与 lib/source.js 的 DEFAULT_BASE 一致 —— 两处语言不同，只能靠用例盯着别漂；
 *   ② 校验值来自发布时产出的 checksums.json，不去解析 winget 清单（那是另一个产物，不该互相绑死）。
 *   ③ 它要在客户机默认的 Windows PowerShell 5.1 上跑得起来 —— 客户机上没有 pwsh，也没有管理员。
 * 只做文本级检查：脚本是 PowerShell，跨语言没法直接调；这里盯的是「不许悄悄改约定」。
 *
 * 跑法：node tests/install-client.test.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SCRIPT_PATH = path.join(ROOT, "scripts", "install-client.ps1");
const SCRIPT = fs.readFileSync(SCRIPT_PATH, "utf8");
const source = require("../lib/source.js");
const { folderOf } = require("../scripts/lib/bundle-name.js");

function main() {
  assert.ok(
    SCRIPT.indexOf('$Base = "' + source.DEFAULT_BASE + '"') >= 0,
    "脚本里的默认基址要与 lib/source.js 的 DEFAULT_BASE 一致（改默认源时两处一起改）"
  );
  assert.ok(SCRIPT.indexOf("checksums.json") >= 0, "校验值取 checksums.json");
  /*
   * 包名这条跨语言副本也要盯：打包脚本与 winget 清单都从 scripts/lib/bundle-name.js 取名字，
   * PowerShell 引不到那边，只能靠这里断言两边拼出来的是同一个（改前缀时这里会红）。
   */
  assert.ok(
    SCRIPT.indexOf(folderOf("$Version") + ".zip") >= 0,
    "脚本拼的 zip 名要与 scripts/lib/bundle-name.js 同口径"
  );
  assert.ok(
    SCRIPT.indexOf("BigStart.MasterGoTranscoder.installer.yaml") < 0,
    "不该再去解析 winget 清单：两个产物各管各的"
  );
  assert.ok(SCRIPT.indexOf("$ZipUrl") >= 0 && SCRIPT.indexOf("$Sha256") >= 0, "非 GitHub 形状的来源要能显式给地址与哈希");
  // 非 GitHub 形状不能再自己拼「releases/download」那种地址：那一形状只出现在 GitHub 那条分支里
  // （zip 一次、checksums.json 一次），给了 -ZipUrl 就不走这两行。
  assert.strictEqual(
    (SCRIPT.match(/releases\/download/g) || []).length,
    2,
    "「releases/download」的拼法只应出现在 GitHub 形状那一条路上"
  );

  // Windows PowerShell 5.1 按 BOM 取编码：不带 BOM 就会拿系统 ANSI（本机 GBK）去解 UTF-8 的中文，
  // 轻则乱码，重则双字节前导吞掉后面的引号、报「字符串缺少终止符」。
  const bytes = fs.readFileSync(SCRIPT_PATH);
  assert.ok(
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    "脚本要存成 UTF-8 带 BOM：客户机上跑的是 Windows PowerShell 5.1"
  );
  assert.ok(
    SCRIPT.indexOf("SecurityProtocolType]::Tls12") >= 0,
    "要显式打开 TLS 1.2：5.1 默认可能只开 TLS 1.0，连不上 GitHub"
  );
  // 客户机上是 5.1，PowerShell 7 才有的语法一律不许出现在这个脚本里。
  for (const token of ["??", "&&", "||", "?.", "-SkipHttpErrorCheck", "-Parallel"]) {
    assert.ok(SCRIPT.indexOf(token) < 0, "不能用 PowerShell 7 才有的语法：" + token);
  }

  // 安装文档里那段「先取脚本再运行」写的是默认基址：它也得跟着 DEFAULT_BASE 走，别在文档里留一份会过期的副本。
  const DOC = fs.readFileSync(path.join(ROOT, "docs", "install.md"), "utf8");
  assert.ok(
    DOC.indexOf(source.DEFAULT_BASE) >= 0,
    "安装文档里的取脚本地址要与 lib/source.js 的 DEFAULT_BASE 一致（改默认源时一起改）"
  );

  console.log("install-client.test.js 全部通过");
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
