#!/usr/bin/env node
"use strict";

/*
 * 待确认清单里的布局一节：这一页要不要人确认布局。
 *
 * 判据（与插件那条停点同口径）：有设计稿位图、还没有分组表 —— 表在不在看 lib/workdir.js，
 * 空分组表也算有表（那是「本页没有要声明的分组」）。控件清单还没产出时不列成待办：
 * 那时候分组没得填，还没走到该确认的时候。
 * 跑法：node tests/pending-layout.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createPending } = require("../lib/pending.js");
const designImage = require("../lib/design-image.js");

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
    JSON.stringify({ nodes: [{ ref: "a", controlType: "IconButton", absX: 10, absY: 20, w: 100, h: 40 }] }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(generated, "runs", TARGET, "dsl.snapshot.json"),
    JSON.stringify({ dsl: { nodes: [{ type: "FRAME", id: "root", layoutStyle: { width: 1280, height: 1024 } }] } }),
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

function layoutOf(root, pending) {
  return pending.inspect({ projectRoot: root, target: TARGET }).layout;
}

function pendingFor(root) {
  return createPending({ plugin: { root: pluginStub(root) } });
}

function caseNothingYet() {
  const root = sandbox();
  // 还没跑到取数那一步：没有图、没有清单 —— 不是待办。
  assert.deepStrictEqual(layoutOf(root, pendingFor(root)), { needsGroups: false, waiting: 0, controls: [] });
  fs.rmSync(root, { recursive: true, force: true });
}

function caseNoImageNoTodo() {
  const root = sandbox();
  writeControls(root);
  assert.strictEqual(layoutOf(root, pendingFor(root)).waiting, 0, "没有设计稿位图就不停在布局确认（纯机械推导照常走）");
  fs.rmSync(root, { recursive: true, force: true });
}

function caseImageWithoutGroups() {
  const root = sandbox();
  writeControls(root);
  writeImage(root);
  const layout = layoutOf(root, pendingFor(root));
  assert.strictEqual(layout.needsGroups, true, "有图没有表 = 要人确认");
  assert.strictEqual(layout.waiting, 1, "要人确认的条数是 1");
  assert.strictEqual(layout.controls.length, 1, "控件清单跟着一起给出来（AI 出候选要用）");
  fs.rmSync(root, { recursive: true, force: true });
}

function caseImageWithEmptyGroups() {
  const root = sandbox();
  writeControls(root);
  writeImage(root);
  writeGroups(root, []);
  const layout = layoutOf(root, pendingFor(root));
  assert.strictEqual(layout.needsGroups, false, "空分组表也算有表：本页没有要声明的分组");
  assert.strictEqual(layout.waiting, 0);
  fs.rmSync(root, { recursive: true, force: true });
}

function caseImageBeforeControls() {
  const root = sandbox();
  writeImage(root);
  const layout = layoutOf(root, pendingFor(root));
  assert.strictEqual(layout.needsGroups, false, "控件清单还没产出时不列成待办（那时分组没得填）");
  assert.strictEqual(layout.waiting, 0);
  fs.rmSync(root, { recursive: true, force: true });
}

function caseBrokenGroupsAsksAgain() {
  const root = sandbox();
  writeControls(root);
  writeImage(root);
  writeBrokenGroups(root);
  const layout = layoutOf(root, pendingFor(root));
  assert.strictEqual(layout.needsGroups, true, "损坏的表按「没有表」处理：把这一页列出来让人确认一次");
  assert.strictEqual(layout.waiting, 1);
  fs.rmSync(root, { recursive: true, force: true });
}

/*
 * 同一份分组表在一次请求里只读一次：待确认那一节要「有没有表」、布局确认那一节要「表里有什么」，
 * 两者共用同一次读。这条性质按**读盘次数**验（数 readFileSync），不靠读代码看有没有读两遍。
 */
function caseGroupsReadOnce() {
  const root = sandbox();
  writeControls(root);
  writeImage(root);
  writeGroups(root, []);
  const original = fs.readFileSync;
  let reads = 0;
  let snapshots = 0;
  fs.readFileSync = function (file) {
    if (String(file).endsWith(".layout-groups.json")) reads += 1;
    if (String(file).endsWith("dsl.snapshot.json")) snapshots += 1;
    return original.apply(fs, arguments);
  };
  try {
    layoutOf(root, pendingFor(root));
    assert.strictEqual(reads, 1, "一次 pending.inspect（要「有没有表」+「表里有什么」）只读一次分组表");
    assert.strictEqual(snapshots, 1, "一次 pending.inspect 只读一次 DSL 快照（控件文本那一处）");

    // 设计稿位图那一份读视图自己读一次；「有没有图」只看文件在不在，不读表。
    reads = 0;
    designImage.read({ projectRoot: root, target: TARGET });
    assert.strictEqual(reads, 1, "一次 /api/design-image 的读视图读一次分组表");
    reads = 0;
    designImage.hasImage({ projectRoot: root, target: TARGET });
    assert.strictEqual(reads, 0, "「有没有图」不读分组表");
  }
  finally {
    fs.readFileSync = original;
  }
  fs.rmSync(root, { recursive: true, force: true });
}

try {
  const cases = [
    ["还没跑到取数那一步", caseNothingYet],
    ["没有位图就不是待办", caseNoImageNoTodo],
    ["有图没有表 = 要人确认", caseImageWithoutGroups],
    ["空分组表也算有表", caseImageWithEmptyGroups],
    ["只有图、还没有控件清单", caseImageBeforeControls],
    ["分组表损坏 = 按没有表处理，让人重写一次", caseBrokenGroupsAsksAgain],
    ["同一份分组表一次请求只读一次", caseGroupsReadOnce]
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
