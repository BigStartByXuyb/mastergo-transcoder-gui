#!/usr/bin/env node
"use strict";

// 项目登记表读取：没登记表不是错误、坏 JSON 如实报、区域前缀按「ui → derivation 里的 F<n>」取。
// 跑法：node tests/project-pages.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { readPageRegistry } = require("../lib/project-pages.js");

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function caseMissingAndEmpty() {
  assert.strictEqual(readPageRegistry("").exists, false);
  assert.match(readPageRegistry("").problem, /工程目录/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-pages-"));
  const missing = readPageRegistry(root);
  assert.strictEqual(missing.exists, false);
  assert.match(missing.problem, /page-registry\.json/, "没有登记表要说清是缺哪个文件");
  assert.ok(missing.registryPath.endsWith(path.join("docs", "page-registry.json")));
  fs.rmSync(root, { recursive: true, force: true });
}

function casePagesAndFallbacks() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-pages-"));
  write(path.join(root, "docs", "page-registry.json"), JSON.stringify({
    pages: [
      {
        target: "F3Align",
        ui: "F3",
        designSource: { fileId: "111", layerId: "3:1", designPageName: "手动对准" }
      },
      {
        target: "F4Run",
        derivation: "按设计页名推导 F4Run（F4）",
        designSource: { fileId: "222", layerId: "4:1" }
      },
      { note: "没有 target 也没有 designSource 的条目要丢掉" }
    ]
  }));
  const info = readPageRegistry(root);
  assert.strictEqual(info.exists, true);
  assert.strictEqual(info.problem, "");
  assert.deepStrictEqual(info.pages.map((page) => page.target), ["F3Align", "F4Run"]);
  assert.strictEqual(info.pages[0].ui, "F3", "显式 ui 最优先");
  assert.strictEqual(info.pages[0].designPageName, "手动对准");
  assert.strictEqual(info.pages[0].fileId, "111");
  assert.strictEqual(info.pages[1].ui, "F4", "没有 ui 时从 derivation 里取第一个 F<n>");
  fs.rmSync(root, { recursive: true, force: true });
}

function caseBrokenJson() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-pages-"));
  write(path.join(root, "docs", "page-registry.json"), "{ not json");
  const info = readPageRegistry(root);
  assert.strictEqual(info.exists, true);
  assert.deepStrictEqual(info.pages, []);
  assert.match(info.problem, /不是合法 JSON/);
  fs.rmSync(root, { recursive: true, force: true });
}

function main() {
  const cases = [
    ["没有登记表不是错误", caseMissingAndEmpty],
    ["登记表条目与区域回退", casePagesAndFallbacks],
    ["坏 JSON 如实报出", caseBrokenJson]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("project-pages.test.js 全部通过");
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
