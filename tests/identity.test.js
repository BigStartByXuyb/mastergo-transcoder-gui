#!/usr/bin/env node
"use strict";

// 页面身份：候选推导（区域取项目既有约定、语义名来自设计页名）与登记表写入（同口径校验 + 覆盖/追加）。
// 跑法：node tests/identity.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { candidatesFor, writeRegistryEntry, pascalFromPageName } = require("../lib/identity.js");
const { readRegistryDocument } = require("../lib/project-pages.js");

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function project(registry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-identity-"));
  if (registry !== undefined) write(path.join(root, "docs", "page-registry.json"), JSON.stringify(registry));
  return root;
}

function casePrefixAndPascal() {
  assert.strictEqual(pascalFromPageName("手动对准 （2.2.1）"), "", "中文页名转不出英文");
  assert.strictEqual(pascalFromPageName("Manual Align (2.2.1)"), "ManualAlign");
  assert.strictEqual(pascalFromPageName("laser-focus"), "LaserFocus");
  assert.strictEqual(pascalFromPageName(""), "");
  // 区域前缀规则由后端持有（写盘校验与界面预览同一份）：这里断言「候选的 target 一定能推出它的 ui」。
  const root = project({ pages: [{ target: "F3Align", ui: "F3", designSource: { fileId: "1", layerId: "3:1" } }] });
  const info = candidatesFor({ projectRoot: root, pageName: "Manual Align" });
  for (const candidate of info.candidates) {
    if (!candidate.target || candidate.needsSemanticName) continue;
    const written = writeRegistryEntry({ projectRoot: root, target: candidate.target, ui: candidate.ui, fileId: "1", layerId: "9:9" });
    assert.ok(written.entry.target.startsWith(candidate.ui), "候选必须满足「Target 前缀 = 区域」");
  }
  fs.rmSync(root, { recursive: true, force: true });
}

function caseCandidates() {
  const root = project({
    pages: [
      { target: "F2Teach", ui: "F2", designSource: { fileId: "1", layerId: "2:1" } },
      { target: "F3Align", ui: "F3", designSource: { fileId: "1", layerId: "3:1" } },
      { target: "F2Target", ui: "F2", designSource: { fileId: "1", layerId: "2:2" } }
    ]
  });
  const info = candidatesFor({ projectRoot: root, pageName: "Manual Align (2.2.1)" });
  assert.deepStrictEqual(info.uiCandidates.map((item) => item.ui), ["F2", "F3"], "区域按项目里的使用频次排");
  assert.strictEqual(info.candidates[0].target, "F2ManualAlign", "给出的候选直接满足「Target 前缀 = 区域」");
  assert.strictEqual(info.candidates[0].needsSemanticName, false);
  assert.match(info.candidates[0].basis, /设计页名/);
  assert.ok(info.candidates.some((item) => item.needsSemanticName), "还要给出「只要区域、语义名待给」的候选");

  const noRegistry = candidatesFor({ projectRoot: project(), pageName: "Manual Align" });
  assert.deepStrictEqual(noRegistry.candidates, [], "项目里没有既有区域约定时，不凭空编一个区域");
  fs.rmSync(root, { recursive: true, force: true });
}

function caseWrite() {
  const root = project();
  const first = writeRegistryEntry({
    projectRoot: root,
    target: "F3ManualAlign",
    ui: "F3",
    fileId: "204689197363903",
    layerId: "1872:60904",
    designPageName: "手动对准"
  });
  assert.strictEqual(first.replaced, false);
  let document = JSON.parse(fs.readFileSync(first.registryPath, "utf8"));
  assert.strictEqual(document.pages.length, 1);
  assert.deepStrictEqual(document.pages[0].designSource, {
    fileId: "204689197363903",
    layerId: "1872:60904",
    designPageName: "手动对准"
  });

  // 同一个 layerId 再写一次：就地替换，不追加
  const again = writeRegistryEntry({ projectRoot: root, target: "F3ManualAlignV2", ui: "F3", fileId: "204689197363903", layerId: "1872:60904" });
  assert.strictEqual(again.replaced, true);
  document = JSON.parse(fs.readFileSync(again.registryPath, "utf8"));
  assert.strictEqual(document.pages.length, 1);
  assert.strictEqual(document.pages[0].target, "F3ManualAlignV2");

  // 已有别的页面时追加，且不丢原有条目
  writeRegistryEntry({ projectRoot: root, target: "F2Teach", ui: "F2", fileId: "1", layerId: "2:1" });
  document = JSON.parse(fs.readFileSync(again.registryPath, "utf8"));
  assert.deepStrictEqual(document.pages.map((page) => page.target), ["F3ManualAlignV2", "F2Teach"]);
  fs.rmSync(root, { recursive: true, force: true });
}

// 原始文档读取只此一份：坏 JSON 的文案与 identity 写回用的是同一处。
function caseRegistryDocument() {
  const root = project();
  assert.deepStrictEqual(readRegistryDocument(root), {
    registryPath: path.join(root, "docs", "page-registry.json"),
    document: null
  });
  write(path.join(root, "docs", "page-registry.json"), JSON.stringify({ pages: [{ target: "F2X", ui: "F2" }], keep: 1 }));
  const raw = readRegistryDocument(root);
  assert.strictEqual(raw.document.keep, 1, "原始文档要原样给出（写回时保留未识别字段）");
  write(path.join(root, "docs", "page-registry.json"), "{ not json");
  assert.throws(() => readRegistryDocument(root), /不是合法 JSON/);
  fs.rmSync(root, { recursive: true, force: true });
}

function caseWriteRejections() {
  const root = project();
  assert.throws(() => writeRegistryEntry({ projectRoot: root, target: "F3X", ui: "" }), /缺少区域前缀/);
  assert.throws(() => writeRegistryEntry({ projectRoot: root, target: "", ui: "F3" }), /缺少 Target/);
  assert.throws(() => writeRegistryEntry({ projectRoot: "", target: "F3X", ui: "F3" }), /缺少工程目录/);
  assert.throws(
    () => writeRegistryEntry({ projectRoot: root, target: "test_mastergp", ui: "F3" }),
    /Target 与区域不匹配/,
    "写出来的登记表不能自相矛盾：Target 前缀推不出 F3 就拒绝"
  );

  const broken = project();
  write(path.join(broken, "docs", "page-registry.json"), "{ not json");
  assert.throws(() => writeRegistryEntry({ projectRoot: broken, target: "F3X", ui: "F3" }), /不是合法 JSON/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(broken, { recursive: true, force: true });
}

function main() {
  const cases = [
    ["区域前缀与 PascalCase", casePrefixAndPascal],
    ["候选推导", caseCandidates],
    ["原始登记表读取只此一份", caseRegistryDocument],
    ["写登记表：追加与替换", caseWrite],
    ["写登记表：拒绝不合法输入", caseWriteRejections]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("identity.test.js 全部通过");
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
