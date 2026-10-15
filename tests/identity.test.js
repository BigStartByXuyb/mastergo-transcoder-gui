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
  assert.deepStrictEqual(info.uiCandidates.map((item) => item.ui), ["F2", "F3"], "区域按使用频次排");
  assert.match(info.blocked, /还没登记过区域/, "没有页帧先例 → 要人点一次");
  assert.strictEqual(info.candidates[0].target, "F2ManualAlign", "给出的候选直接满足「Target 前缀 = 区域」");
  assert.strictEqual(info.candidates[0].needsSemanticName, false);
  assert.match(info.candidates[0].basis, /设计页名/);
  assert.ok(info.candidates.some((item) => item.needsSemanticName), "还要给出「只要区域、语义名待给」的候选");

  const noRegistry = candidatesFor({ projectRoot: project(), pageName: "Manual Align" });
  assert.deepStrictEqual(noRegistry.candidates, [], "项目里没有既有区域约定时，不凭空编一个区域");
  assert.match(noRegistry.blocked, /还没有任何区域约定/, "空工程要说清这是「工程项目第一页要人给一次」");
  assert.match(noRegistry.blocked, /docs\/page-registry\.json/, "要告诉人给过之后写在哪、以后自动");

  // 同一设计文件优先：F1 只在这个文件里出现，F2 是全项目更多 → 这个文件仍然先给 F1
  const scoped = project({
    pages: [
      { target: "F2A", ui: "F2", designSource: { fileId: "9", layerId: "2:1" } },
      { target: "F2B", ui: "F2", designSource: { fileId: "9", layerId: "2:2" } },
      { target: "F1StopAdjust", ui: "F1", designSource: { fileId: "7", layerId: "1:1" } }
    ]
  });
  const scopedInfo = candidatesFor({ projectRoot: scoped, pageName: "Stop Adjust", fileId: "7", layerId: "1:9" });
  assert.strictEqual(scopedInfo.uiCandidates[0].ui, "F1", "同一设计文件里出现过的区域优先");
  assert.match(scopedInfo.blocked, /还没登记过区域/, "同一文件里有先例也不自动：别的页帧的区域不是这一页的区域");
  assert.match(scopedInfo.uiCandidates[0].basis, /同一设计文件/);
  fs.rmSync(scoped, { recursive: true, force: true });

  // 设计页名与登记不一致 → 提示改名，不静默沿用
  const renamed = project({
    pages: [{ target: "F1StopAdjust", ui: "F1", designSource: { fileId: "7", layerId: "1:1", designPageName: "停止调整" } }]
  });
  const renameInfo = candidatesFor({ projectRoot: renamed, pageName: "停止微调", fileId: "7", layerId: "1:1" });
  assert.ok(renameInfo.candidates.some((item) => item.rename), "改名要给出显式确认项");
  assert.match(renameInfo.blocked, /改了名/, "改了名不能静默沿用旧 Target");
  fs.rmSync(renamed, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}

// 页帧（layerId）是唯一的自动键：登记过就沿用，没登记过就要人点一次。
function caseLayerScope() {
  const root = project({
    pages: [
      { target: "F4TargetTeaching", ui: "F4", designSource: { fileId: "181", layerId: "357:290731", designPageName: "目标示教" } }
    ]
  });

  // 同一设计文件里的另一页帧：不算这一页的先例（实测踩过：同文件的 F4 被当成了别页的区域先例）
  const other = candidatesFor({ projectRoot: root, pageName: "StopAdjust", fileId: "181", layerId: "357:269592" });
  assert.match(other.blocked, /357:269592/, "挡住的原因要指出是哪一个页帧没登记过");
  assert.ok(other.uiCandidates.some((item) => item.ui === "F4"), "候选里照样给出同文件的既有区域，供人点一下");

  // 这一页登记过、页名没变 → 自动沿用登记那一条，而且排在第一
  const same = candidatesFor({ projectRoot: root, pageName: "目标示教", fileId: "181", layerId: "357:290731" });
  assert.strictEqual(same.blocked, "", "这一页登记过 → 可以自动沿用");
  assert.strictEqual(same.candidates[0].target, "F4TargetTeaching");
  assert.strictEqual(same.candidates[0].registered, true);
  assert.strictEqual(same.candidates[0].designPageName, "目标示教", "沿用登记那条要把登记里的页名带回去");

  // 登记过的页帧但页名变了 → 不自动
  const changed = candidatesFor({ projectRoot: root, pageName: "停止调整", fileId: "181", layerId: "357:290731" });
  assert.match(changed.blocked, /改了名/);

  // 页帧登记过但没写区域 → 照样要人给一次（没有区域就写不出产物目录）
  const noUi = project({
    pages: [{ target: "F4TargetTeaching", designSource: { fileId: "181", layerId: "357:290731" } }]
  });
  const withoutUi = candidatesFor({ projectRoot: noUi, pageName: "目标示教", fileId: "181", layerId: "357:290731" });
  assert.match(withoutUi.blocked, /还没登记过区域/, "登记条目缺区域时不能当成可以自动");
  fs.rmSync(noUi, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}

// 人指定区域（界面上填了 UI 区域）：候选只剩语义名这一件事，且不许再被 blocked 拦住。
function caseExplicitUi() {
  const root = project({
    pages: [{
      target: "F4TargetTeaching",
      ui: "F4",
      designSource: { fileId: "181", layerId: "357:290731", designPageName: "目标示教" }
    }]
  });

  // 英文设计页名：直接给出「F1 + 语义名」的整条候选，能点
  const ascii = candidatesFor({
    projectRoot: root, pageName: "StopAdjust", fileId: "181", layerId: "357:269592", explicitUi: "F1"
  });
  assert.strictEqual(ascii.blocked, "", "人给了区域就不该再拦");
  assert.deepStrictEqual(ascii.uiCandidates.map((item) => item.ui), ["F1"], "只按人给的区域算");
  assert.strictEqual(ascii.candidates[0].target, "F1StopAdjust", "候选要拼成人给的那个区域");
  assert.strictEqual(ascii.candidates[0].needsSemanticName, false);
  assert.ok(ascii.candidates.every((item) => item.ui === "F1"), "项目里别的区域不许混进候选");

  // 中文设计页名转不出语义名：只剩「区域、语义名待给」这一条，人要自己定名
  const cjk = candidatesFor({
    projectRoot: root, pageName: "停止调整", fileId: "181", layerId: "357:269592", explicitUi: "F1"
  });
  assert.strictEqual(cjk.blocked, "");
  assert.strictEqual(cjk.candidates.length, 1);
  assert.strictEqual(cjk.candidates[0].needsSemanticName, true);

  // 人给的区域跟登记表里这一页记的不一致：登记那条不再顶到最前，避免自动采用错的那条
  const conflicted = candidatesFor({
    projectRoot: root, pageName: "目标示教", fileId: "181", layerId: "357:290731", explicitUi: "F1"
  });
  assert.ok(conflicted.candidates.every((item) => item.ui === "F1"), "人指定区域后不许把登记过的 F4 排到前面");

  // 改名优先于「人给了区域」：这一页换过身份，给不给出区域都要显式确认一次
  const renamedExplicit = candidatesFor({
    projectRoot: root, pageName: "停止调整", fileId: "181", layerId: "357:290731", explicitUi: "F1"
  });
  assert.match(renamedExplicit.blocked, /改了名/, "人填了区域也不能把改名这件事静默吞掉");
  assert.match(renamedExplicit.blocked, /F4TargetTeaching/, "要说清登记的是哪一条 Target");
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
    ["页帧范围：登记过才自动", caseLayerScope],
    ["人指定区域：只按那个区域算", caseExplicitUi],
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
