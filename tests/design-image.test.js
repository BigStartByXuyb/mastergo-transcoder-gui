#!/usr/bin/env node
"use strict";

// 作业A 的设计稿位图：图放哪儿、尺寸对不对、分组表在不在。
// 跑法：node tests/design-image.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const designImage = require("../lib/design-image.js");

const TARGET = "DemoPage";

/* 最小 PNG：签名 + IHDR（宽高在 16 / 20）。解析器只看这两处。 */
function png(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/* 最小 JPEG：SOI + SOF0（精度 / 高 / 宽跟在段长后面）。 */
function jpeg(width, height) {
  const buffer = Buffer.alloc(12);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer.writeUInt16BE(17, 4);
  buffer[6] = 8;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

/* 一份 BMP 的文件头（只为了验「别的格式不接」）。 */
function bmp(width, height) {
  const buffer = Buffer.alloc(32);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(width, 18);
  buffer.writeUInt32LE(height, 22);
  return buffer;
}

/* 一份最小工程：DSL 快照（画板 1280×1024）+ _inputs 目录。 */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-design-image-"));
  const run = path.join(root, "Generated", "runs", TARGET);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(
    path.join(run, "dsl.snapshot.json"),
    JSON.stringify({ dsl: { nodes: [{ type: "FRAME", id: "1:1", layoutStyle: { width: 1280, height: 1024 } }] } }),
    "utf8"
  );
  return root;
}

function upload(projectRoot, buffer, name) {
  return designImage.save({ projectRoot: projectRoot, target: TARGET, name: name || "DemoPage.design.png", data: buffer.toString("base64") });
}

function caseSaveAndRead() {
  const root = sandbox();
  const before = designImage.read({ projectRoot: root, target: TARGET });
  assert.strictEqual(before.image, null, "还没传时没有图");
  assert.deepStrictEqual(before.canvas, { width: 1280, height: 1024 }, "画板尺寸取自 DSL 根节点");
  assert.strictEqual(before.groups.exists, false);
  assert.match(before.dir, /Generated[\\/]_inputs$/, "图该放的目录照实给出来");

  const saved = upload(root, png(1280, 1024));
  assert.strictEqual(saved.matches, true, "尺寸与画板一致");
  assert.strictEqual(saved.image.width, 1280);
  assert.strictEqual(saved.image.height, 1024);
  // 认的是内容的真实格式：PNG 落成 .design.png（JPEG 落成 .design.jpg，见下面的换格式用例）。
  assert.strictEqual(saved.image.name, "DemoPage.design.png");
  assert.ok(fs.existsSync(path.join(root, "Generated", "_inputs", "DemoPage.design.png")), "落在 _inputs 下、用约定名");
  fs.rmSync(root, { recursive: true, force: true });
}

/* 只接这两种：JPEG 也要认得出宽高（尺寸这一格与格式那一格都从同一份文件头来）。 */
function caseJpeg() {
  const root = sandbox();
  const saved = upload(root, jpeg(1280, 1024), "shot.jpeg");
  assert.strictEqual(saved.matches, true);
  assert.strictEqual(saved.image.name, "DemoPage.design.jpg", "JPEG 落成 .design.jpg");
  assert.strictEqual(saved.image.width, 1280);
  assert.strictEqual(saved.image.height, 1024);
  fs.rmSync(root, { recursive: true, force: true });
}

// 换格式时只留一张：插件按「png → jpg → jpeg」的顺序取，留着旧那张就会取错。
function caseReplace() {
  const root = sandbox();
  upload(root, png(1280, 1024));
  upload(root, jpeg(1280, 1024), "shot.jpg");
  const dir = path.join(root, "Generated", "_inputs");
  const left = fs.readdirSync(dir).filter((name) => name.startsWith("DemoPage.design."));
  assert.deepStrictEqual(left, ["DemoPage.design.jpg"], "换成 jpg 之后旧 png 要删掉");
  const now = designImage.read({ projectRoot: root, target: TARGET });
  assert.strictEqual(now.image.name, "DemoPage.design.jpg");
  assert.strictEqual(now.matches, true);
  fs.rmSync(root, { recursive: true, force: true });
}

function caseRejections() {
  const root = sandbox();
  // 认的是内容：名字写成 .bmp，内容真是 PNG，就按 PNG 落盘（不因为名字把它挡在外面，也不会落成 .bmp）。
  const renamed = upload(root, png(1280, 1024), "shot.bmp");
  assert.strictEqual(renamed.image.name, "DemoPage.design.png");
  // 只清这一张（别把 DSL 快照一起删了：下面还要用它核「尺寸不一致」）。
  fs.rmSync(renamed.image.path, { force: true });
  assert.throws(() => upload(root, Buffer.from("这不是图")), /这一份两种都不是/, "内容不是位图的，改名字也进不来");
  assert.throws(() => upload(root, bmp(1280, 1024)), /这一份两种都不是/, "别的格式（BMP）不接");
  assert.throws(() => upload(root, png(1280, 1023)), (error) => {
    assert.strictEqual(error.code, "SIZE_MISMATCH");
    assert.match(error.message, /图 1280×1023，画板 1280×1024/);
    assert.match(error.hint, /原始尺寸/);
    return true;
  });
  assert.throws(() => designImage.read({ projectRoot: root, target: "" }), /缺少页面 Target/);
  fs.rmSync(root, { recursive: true, force: true });
}

// 还没跑到第 2 步（没有快照）时：画板尺寸没有真值，判据没有基准 —— fail-closed，不收这张图。
function caseNoSnapshot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-design-image-nosnap-"));
  const state = designImage.read({ projectRoot: root, target: TARGET });
  assert.strictEqual(state.canvas, null);
  assert.throws(() => upload(root, png(640, 480)), (error) => {
    assert.strictEqual(error.code, "NO_CANVAS");
    assert.match(error.message, /还不知道这一页的画板尺寸/);
    assert.match(error.hint, /第 2 步/);
    return true;
  });
  fs.rmSync(root, { recursive: true, force: true });
}

// 分组表在不在照实报：有图无表是流程漏步，说清是界面的事，判定在第 8 步。
function caseGroups() {
  const root = sandbox();
  fs.mkdirSync(path.join(root, "Generated", "_inputs"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "Generated", "_inputs", TARGET + ".layout-groups.json"),
    JSON.stringify({ schemaVersion: "mw-wpf-layout-groups/1", pageTarget: TARGET, groups: [] }),
    "utf8"
  );
  const state = designImage.read({ projectRoot: root, target: TARGET });
  assert.strictEqual(state.groups.exists, true);
  assert.match(state.groups.path, /layout-groups\.json$/);
  fs.rmSync(root, { recursive: true, force: true });
}

try {
  const cases = [
    ["存一张 PNG 并读回状态", caseSaveAndRead],
    ["JPEG 也认（尺寸与后缀都按内容）", caseJpeg],
    ["换格式只留一张", caseReplace],
    ["拒绝的几种", caseRejections],
    ["还没跑到第 2 步", caseNoSnapshot],
    ["分组表在不在", caseGroups]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("design-image.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
