#!/usr/bin/env node
"use strict";

// 作业A 的设计稿位图：图放哪儿、尺寸对不对、分组表在不在。
// 跑法：node tests/design-image.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const designImage = require("../lib/design-image.js");
const { png, jpeg, bmp } = require("./image-fixtures.js");

const TARGET = "DemoPage";
// 暂存件的键：一条任务一份（后端只有 lib/design-image.js 的 stagedPathOf 定这个键）。
const TASK = "6f1d0f0e-0000-4000-8000-000000000001";

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
  assert.strictEqual(before.blocked, "", "画板尺寸读得出来就能传");

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
  assert.match(state.blocked, /先让流水线跑到「取数 \+ 固化快照」那一步/, "不能传时把原因给界面照实显示");
  assert.throws(() => upload(root, png(640, 480)), (error) => {
    assert.strictEqual(error.code, "NO_CANVAS");
    assert.match(error.message, /还不知道这一页的画板尺寸/);
    assert.match(error.hint, /取数 \+ 固化快照/);
    return true;
  });
  fs.rmSync(root, { recursive: true, force: true });
}

/*
 * 分组表可用照实报（文件在且解析出 groups 数组，空数组合法）：有图无表是流程漏步，判定在第 8 步。
 * 空表是「本页没有要声明的分组」，照旧算有表 —— 判据只有 lib/workdir.js 一处。
 */
function caseGroups() {
  const root = sandbox();
  fs.mkdirSync(path.join(root, "Generated", "_inputs"), { recursive: true });
  const file = path.join(root, "Generated", "_inputs", TARGET + ".layout-groups.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: "mw-wpf-layout-groups/1",
      pageTarget: TARGET,
      groups: [{ id: "g1", kind: "column", members: ["a", "b"] }]
    }),
    "utf8"
  );
  const state = designImage.read({ projectRoot: root, target: TARGET });
  assert.strictEqual(state.groups.exists, true);
  assert.match(state.groups.path, /layout-groups\.json$/);

  fs.writeFileSync(
    file,
    JSON.stringify({ schemaVersion: "mw-wpf-layout-groups/1", pageTarget: TARGET, groups: [] }),
    "utf8"
  );
  assert.strictEqual(designImage.read({ projectRoot: root, target: TARGET }).groups.exists, true, "空表也算有表");
  fs.rmSync(root, { recursive: true, force: true });
}

/*
 * 新建任务时先选好的图：那时还不知道画板尺寸，所以先暂存；任务跑到「取数 + 固化快照」之后
 * 由看板那侧核对尺寸再装进工作目录（插件从那读图），暂存件随之删掉。
 */
function caseStageThenInstall() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-design-image-home-"));
  const root = sandbox();
  const staged = designImage.stage({ home: home, taskId: TASK, data: png(1280, 1024).toString("base64") });
  assert.strictEqual(staged.width, 1280, "暂存时就把尺寸读出来了（给人看的那两个数）");
  assert.ok(fs.existsSync(staged.path), "暂存件落盘");
  assert.strictEqual(path.basename(staged.path), TASK + ".staged", "暂存件按任务 id 落键");

  // 画板尺寸还没产出（没有快照）时什么都不做 —— 那时没有基准可核。
  const noSnapshot = fs.mkdtempSync(path.join(os.tmpdir(), "gui-design-image-nosnap2-"));
  assert.strictEqual(designImage.installStaged({ home: home, taskId: TASK, target: TARGET, workDir: noSnapshot }), null);
  assert.ok(fs.existsSync(staged.path), "还没到那一步，暂存件留着等下一次轮询");
  fs.rmSync(noSnapshot, { recursive: true, force: true });

  const workDir = sandbox();
  const installed = designImage.installStaged({ home: home, taskId: TASK, target: TARGET, workDir: workDir });
  assert.match(installed.installed, /DemoPage\.design\.png$/);
  assert.ok(designImage.read({ projectRoot: workDir, target: TARGET }).matches, "装进去之后与画板尺寸一致");
  assert.ok(!fs.existsSync(staged.path), "落地之后暂存件删掉（不留第二份）");
  assert.strictEqual(designImage.installStaged({ home: home, taskId: TASK, target: TARGET, workDir: workDir }), null);

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
}

function caseStagedMismatch() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-design-image-home-"));
  const root = sandbox();
  const staged = designImage.stage({ home: home, taskId: TASK, data: png(1280, 1023).toString("base64") });
  const workDir = sandbox();

  const result = designImage.installStaged({ home: home, taskId: TASK, target: TARGET, workDir: workDir });
  assert.deepStrictEqual(result.mismatch, { image: { width: 1280, height: 1023 }, canvas: { width: 1280, height: 1024 } });
  assert.strictEqual(designImage.read({ projectRoot: workDir, target: TARGET }).image, null, "对不上就不装");
  assert.ok(fs.existsSync(staged.path), "对不上的那一份留着：人重导一张再选一次，覆盖的就是它");

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
}

function caseStagedKeepsExisting() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-design-image-home-"));
  const root = sandbox();
  const staged = designImage.stage({ home: home, taskId: TASK, data: png(1280, 1024).toString("base64") });
  const workDir = sandbox();
  // 工作目录里已经有人传过一张（人在布局那一步补的）：暂存件不动它。
  designImage.save({ projectRoot: workDir, target: TARGET, data: png(1280, 1024).toString("base64") });
  const before = designImage.read({ projectRoot: workDir, target: TARGET }).image.path;

  assert.strictEqual(designImage.installStaged({ home: home, taskId: TASK, target: TARGET, workDir: workDir }), null);
  assert.strictEqual(designImage.read({ projectRoot: workDir, target: TARGET }).image.path, before, "已有的图不被覆盖");
  assert.ok(!fs.existsSync(staged.path), "那一位已经不需要了，暂存件清掉");

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
}

/* 任务被移除时把还没轮到的暂存件一起收掉：暂存件不在看板上，留着没人认领。 */
/*
 * 暂存件落盘之后坏掉（截断 / 内容变了）：不编一个 0×0 当「尺寸不符」报出去，
 * 就回一句「读不出来」，暂存件留着等人重新传一张。
 */
function caseStagedUnreadable() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-design-image-home-"));
  const staged = designImage.stage({ home: home, taskId: TASK, data: png(1280, 1024).toString("base64") });
  fs.writeFileSync(staged.path, Buffer.from("这不是位图", "utf8"));
  const workDir = sandbox();

  assert.deepStrictEqual(
    designImage.installStaged({ home: home, taskId: TASK, target: TARGET, workDir: workDir }),
    { unreadable: true },
    "读不出尺寸就是读不出，不自造 0×0"
  );
  assert.ok(fs.existsSync(staged.path), "那一份留着：人重新传一张就覆盖它");
  assert.strictEqual(designImage.read({ projectRoot: workDir, target: TARGET }).image, null, "读不出就不装");

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
}

function caseDiscardStaged() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-design-image-home-"));
  const staged = designImage.stage({ home: home, taskId: TASK, data: png(1280, 1024).toString("base64") });
  designImage.discardStaged({ home: home, taskId: TASK });
  assert.ok(!fs.existsSync(staged.path), "有就清掉");
  // 没有第二次也不该出事：轮询与移除两条路都会调它。
  designImage.discardStaged({ home: home, taskId: TASK });
  assert.ok(!fs.existsSync(staged.path), "没有就什么都不做");

  // 暂存要认任务：没有任务 id 就没有键，收图这一步拒绝（不是拿工程 / 页面凑一个键）。
  assert.throws(
    function () { designImage.stage({ home: home, projectRoot: "/x", target: TARGET, data: png(4, 4).toString("base64") }); },
    /缺少任务 id/
  );

  fs.rmSync(home, { recursive: true, force: true });
}

try {
  const cases = [
    ["存一张 PNG 并读回状态", caseSaveAndRead],
    ["JPEG 也认（尺寸与后缀都按内容）", caseJpeg],
    ["换格式只留一张", caseReplace],
    ["拒绝的几种", caseRejections],
    ["还没跑到第 2 步", caseNoSnapshot],
    ["分组表在不在", caseGroups],
    ["新建时先选的图：暂存 → 有画板尺寸后核对落地", caseStageThenInstall],
    ["暂存图尺寸不对：不装、回两边的数、暂存件留着等人重导", caseStagedMismatch],
    ["工作目录里已经有人传过图：暂存件不动它、自己清掉", caseStagedKeepsExisting],
    ["暂存件坏了：回「读不出尺寸」，不编 0×0", caseStagedUnreadable],
    ["任务没了：暂存件跟着走", caseDiscardStaged]
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
