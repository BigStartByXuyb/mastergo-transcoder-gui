#!/usr/bin/env node
"use strict";

/*
 * 待确认清单里的布局一节：这一页要不要人确认布局。
 *
 * 判据（与插件那条停点同口径）：有页面 PNG、还没有分组表 —— 表在不在看 lib/workdir.js，
 * 空分组表也算有表（那是「本页没有要声明的分组」）。控件清单还没产出时不列成待办：
 * 那时候分组没得填，还没走到该确认的时候。
 * 跑法：node tests/pending-layout.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createPending } = require("../lib/pending.js");

const TARGET = "DemoPage";
/* 译文那一节要插件自己的派生实现：这里只验布局一节，给它一份最小替身（别让别的节把用例拖住）。 */
const LANG_KEYS_REL = "skills/mastergo-to-wpf/scripts/adapters/mtslg-iocontrol/gen-mtslg-lang-keys-from-dsl.js";

/* 最小工程：只有布局那一节要读的几样，别的产物一概没有。 */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-pending-layout-"));
  fs.mkdirSync(path.join(root, "Generated", "_inputs"), { recursive: true });
  return root;
}

/* 替身插件：认根只看 SKILL.md，译文那一节要的派生实现给一份空的。 */
function pluginStub(root) {
  const dir = path.join(root, "plugin");
  const langKeys = path.join(dir, ...LANG_KEYS_REL.split("/"));
  fs.mkdirSync(path.dirname(langKeys), { recursive: true });
  fs.writeFileSync(path.join(dir, "skills", "mastergo-to-wpf", "SKILL.md"), "# 替身\n", "utf8");
  fs.writeFileSync(langKeys, "module.exports = { deriveLangSpec: function () { return { report: {} }; } };\n", "utf8");
  return dir;
}

function writeControls(root) {
  const generated = path.join(root, "Generated");
  fs.mkdirSync(path.join(generated, "runs", TARGET), { recursive: true });
  fs.writeFileSync(
    path.join(generated, TARGET + ".component-types.json"),
    JSON.stringify({
      nodes: [
        { ref: "a", controlType: "IconButton", absX: 10, absY: 20, w: 100, h: 40 },
        { ref: "b", controlType: "IconButton", absX: 10, absY: 70, w: 100, h: 40 }
      ]
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(generated, "runs", TARGET, "dsl.snapshot.json"),
    JSON.stringify({ dsl: { nodes: [{ type: "FRAME", id: "root", layoutStyle: { width: 1280, height: 1024 } }] } }),
    "utf8"
  );
  /* 分组表能引用的条目清单也是这一步的输入（判据在 lib/layout-candidates.js）：没有它就没得自动出分组。 */
  fs.writeFileSync(
    path.join(generated, "_inputs", TARGET + ".layout-group-candidates.json"),
    JSON.stringify({
      schemaVersion: "mw-wpf-layout-group-candidates/1",
      pageTarget: TARGET,
      source: { dslPath: "", dslSha256: "" },
      entries: [
        { ref: "a", controlType: "IconButton", text: "A" },
        { ref: "b", controlType: "IconButton", text: "B" }
      ]
    }),
    "utf8"
  );
}

/* 图纸只要「有一张」就够：布局那一节只判在不在，尺寸对不对是 lib/design-image.js 的事。 */
function writeImage(root) {
  fs.writeFileSync(path.join(root, "Generated", "_inputs", TARGET + ".design.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]), "utf8");
}

function writeGroups(root, groups) {
  fs.writeFileSync(
    path.join(root, "Generated", "_inputs", TARGET + ".layout-groups.json"),
    JSON.stringify({ schemaVersion: "mw-wpf-layout-groups/1", pageTarget: TARGET, groups: groups }),
    "utf8"
  );
}

/* 损坏的分组表（groups 不是数组）：界面按「没有表」处理，让人重写一次 —— 写回之后表就好了。 */
function writeBrokenGroups(root) {
  fs.writeFileSync(
    path.join(root, "Generated", "_inputs", TARGET + ".layout-groups.json"),
    JSON.stringify({ schemaVersion: "mw-wpf-layout-groups/1", pageTarget: TARGET, groups: { id: "g1" } }),
    "utf8"
  );
}

function layoutOf(root, pending, mode, stoppedAtLayout) {
  const query = {
    projectRoot: root,
    target: TARGET,
    state: stoppedAtLayout ? "waiting" : "",
    layoutStep: stoppedAtLayout ? "layoutManifest" : "",
    failedStep: stoppedAtLayout ? "layoutManifest" : ""
  };
  if (mode !== undefined) query.mode = mode;
  return pending.inspect(query).layout;
}

function pendingFor(root) {
  return createPending({ plugin: { root: pluginStub(root) } });
}

function caseNothingYet() {
  const root = sandbox();
  // 还没跑到取数那一步：没有图、没有清单 —— 不是待办。
  const pending = pendingFor(root).inspect({ projectRoot: root, target: TARGET });
  assert.deepStrictEqual(pending.icons.mustName, [], "图标清单不可用时也必须给前端完整的空数组");
  assert.deepStrictEqual(pending.icons.candidates, []);
  assert.deepStrictEqual(pending.translations.pendingTranslations, [], "译文清单不可用时也必须给前端完整的空数组");
  assert.deepStrictEqual(pending.translations.glossaryRequired, []);
  /* 形状照实钉住：布局待补只报 needsGroups / waiting，不再转发已无消费方的 suggest 状态。 */
  assert.deepStrictEqual(pending.layout, {
    needsGroups: false,
    hasGroups: false,
    rejected: false,
    waiting: 0
  });
  fs.rmSync(root, { recursive: true, force: true });
}

function caseSectionShapesStayStable() {
  const root = sandbox();
  const pending = pendingFor(root);
  const before = pending.inspect({ projectRoot: root, target: TARGET });
  writeControls(root);
  fs.writeFileSync(
    path.join(root, "Generated", "_inputs", TARGET + ".icon-candidates.json"),
    JSON.stringify({ candidates: [], mustName: [] }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "Generated", TARGET + ".mapping.json"),
    JSON.stringify({ nodes: [], textAudit: [] }),
    "utf8"
  );
  const after = pending.inspect({ projectRoot: root, target: TARGET });
  assert.deepStrictEqual(
    Object.keys(before.icons).sort(),
    Object.keys(after.icons).sort(),
    "图标节的可读/不可读分支必须共用同一形状"
  );
  assert.deepStrictEqual(
    Object.keys(before.translations).sort(),
    Object.keys(after.translations).sort(),
    "译文节的可读/不可读分支必须共用同一形状"
  );
  fs.rmSync(root, { recursive: true, force: true });
}

function caseNoImageNoTodo() {
  const root = sandbox();
  writeControls(root);
  assert.strictEqual(layoutOf(root, pendingFor(root)).waiting, 0, "没有页面 PNG 就不停等自动分组（纯机械推导照常走）");
  fs.rmSync(root, { recursive: true, force: true });
}

function caseImageWithoutGroups() {
  const root = sandbox();
  writeControls(root);
  writeImage(root);
  const layout = layoutOf(root, pendingFor(root), "A");
  assert.strictEqual(layout.needsGroups, true, "有图没有表 = 要人确认");
  assert.strictEqual(layout.waiting, 1, "要人确认的条数是 1");
  fs.rmSync(root, { recursive: true, force: true });
}

function caseLayoutOnlyForA() {
  const root = sandbox();
  writeControls(root);
  writeImage(root);
  const pending = pendingFor(root);
  assert.deepStrictEqual(
    layoutOf(root, pending),
    layoutOf(root, pending, ""),
    "省略 mode 与显式空串同属路线未知，不能隐式按 A 计算"
  );
  assert.deepStrictEqual(
    layoutOf(root, pending, "B"),
    { needsGroups: false, hasGroups: false, rejected: false, waiting: 0 },
    "B 不消费布局分组"
  );
  assert.deepStrictEqual(
    layoutOf(root, pending, "AB"),
    { needsGroups: true, hasGroups: false, rejected: false, waiting: 1 },
    "AB 的 A 段仍消费布局分组"
  );
  assert.deepStrictEqual(
    layoutOf(root, pending, ""),
    { needsGroups: false, hasGroups: false, rejected: false, waiting: 0 },
    "手填条目没有路线信息，不能假定它消费布局分组"
  );
  fs.rmSync(root, { recursive: true, force: true });
}

function caseImageWithEmptyGroups() {
  const root = sandbox();
  writeControls(root);
  writeImage(root);
  writeGroups(root, []);
  const layout = layoutOf(root, pendingFor(root), "A");
  assert.strictEqual(layout.needsGroups, false, "空分组表也算有表：本页没有要声明的分组");
  assert.strictEqual(layout.hasGroups, true);
  assert.strictEqual(layout.rejected, false, "没有布局步骤停点时，已有表仍算完成");
  assert.strictEqual(layout.waiting, 0);
  fs.rmSync(root, { recursive: true, force: true });
}

function caseRejectedExistingGroupsNeedsRecovery() {
  const root = sandbox();
  writeControls(root);
  writeImage(root);
  writeGroups(root, [{ id: "g1", kind: "row", members: ["a", "b"] }]);
  const pending = pendingFor(root);
  assert.deepStrictEqual(layoutOf(root, pending, "A"), {
    needsGroups: false,
    hasGroups: true,
    rejected: false,
    waiting: 0
  }, "只看磁盘时已有表算完成，不能把完成页误列成待办");
  assert.deepStrictEqual(layoutOf(root, pending, "A", true), {
    needsGroups: false,
    hasGroups: true,
    rejected: true,
    waiting: 1
  }, "来源运行确实停在布局步骤时，已有表也要给出重写入口");
  fs.rmSync(root, { recursive: true, force: true });
}

function caseImageBeforeControls() {
  const root = sandbox();
  writeImage(root);
  const layout = layoutOf(root, pendingFor(root), "A");
  assert.strictEqual(layout.needsGroups, false, "控件清单还没产出时不列成待办（那时分组没得填）");
  assert.strictEqual(layout.waiting, 0);
  fs.rmSync(root, { recursive: true, force: true });
}

function caseImageWithoutCandidates() {
  const root = sandbox();
  writeImage(root);
  fs.writeFileSync(
    path.join(root, "Generated", TARGET + ".component-types.json"),
    JSON.stringify({ nodes: [{ ref: "a" }, { ref: "b" }] }),
    "utf8"
  );
  const layout = layoutOf(root, pendingFor(root), "A");
  assert.strictEqual(layout.needsGroups, false, "条目清单缺失时不列成可写空表的待办");
  assert.strictEqual(layout.waiting, 0);
  fs.rmSync(root, { recursive: true, force: true });
}

function caseBrokenGroupsAsksAgain() {
  const root = sandbox();
  writeControls(root);
  writeImage(root);
  writeBrokenGroups(root);
  const layout = layoutOf(root, pendingFor(root), "A");
  assert.strictEqual(layout.needsGroups, true, "损坏的表按「没有表」处理：把这一页列出来让人确认一次");
  assert.strictEqual(layout.waiting, 1);
  fs.rmSync(root, { recursive: true, force: true });
}

try {
  const cases = [
    ["还没跑到取数那一步", caseNothingYet],
    ["待确认各节形状不随来源是否产出而变化", caseSectionShapesStayStable],
    ["没有位图就不是待办", caseNoImageNoTodo],
    ["有图没有表 = 要人确认", caseImageWithoutGroups],
    ["布局停点只属于含 A 的路线", caseLayoutOnlyForA],
    ["空分组表也算有表", caseImageWithEmptyGroups],
    ["已有分组表被布局步骤拒收时列成恢复停点", caseRejectedExistingGroupsNeedsRecovery],
    ["只有图、还没有控件清单", caseImageBeforeControls],
    ["只有图、类型产物在但条目清单缺失", caseImageWithoutCandidates],
    ["分组表损坏 = 按没有表处理，让人重写一次", caseBrokenGroupsAsksAgain]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("pending-layout.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
