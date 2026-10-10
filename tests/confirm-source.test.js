#!/usr/bin/env node
"use strict";

/*
 * 待确认续跑的来源运行：必须是一条精确的运行，运行管理器里没有它时按调用方给的请求参数续，
 * 不许退回「最近一次运行」——那会把另一页的 fileId / layerId / ui 配着本页的工程目录写进去。
 * 跑法：node tests/confirm-source.test.js
 */

const assert = require("assert");

const { createConfirm } = require("../lib/confirm.js");

const STEPS = [
  { Id: 7, Name: "ledger", Title: "图标台账" },
  { Id: 8, Name: "layout", Title: "Layout 清单" },
  { Id: 9, Name: "inputs", Title: "校验译文" }
];

const icon = (name) => ({ index: 1, name: name, comment: "" });

// 运行管理器桩：只认登记过的那次运行；status() 记下每一次要过的 id，用来证明没有空 id 的猜测。
function makeHarness() {
  const calls = [];
  const written = [];
  const started = [];
  const runs = {
    status: (id) => {
      calls.push(id);
      if (id !== "job-known") return null;
      return {
        id: "job-known",
        request: {
          projectRoot: "D:/work/known",
          target: "T1",
          fileId: "file-1",
          layerId: "layer-1",
          ui: "F1",
          mode: "mtslg-iocontrol"
        },
        runs: [{ steps: { 1: { id: 7, name: "ledger" }, 2: { id: 8, name: "layout" } } }]
      };
    },
    start: (request) => {
      started.push(request);
      return { id: "job-new", request: request };
    },
    contract: () => STEPS
  };
  const confirm = createConfirm({
    runs: runs,
    pending: {
      writeNaming: (args) => {
        written.push(args);
        return { path: "D:/work/known/Generated/_inputs/T1.icon-naming.json", count: args.items.length };
      },
      writeTranslations: () => { throw new Error("这条用例不该写译文"); },
      writeGlossary: () => { throw new Error("这条用例不该写术语"); },
      writeGroups: (args) => {
        written.push(args);
        return { path: "D:/work/known/Generated/_inputs/T1.layout-groups.json", count: args.groups.length };
      },
      reconcileNaming: () => null,
      clearNaming: () => undefined
    },
    steps: () => STEPS
  });
  return { confirm: confirm, calls: calls, written: written, started: started };
}

// 既没有来源运行、也没说要只写文件：明说缺来源，不去问运行管理器。
function caseNoSource() {
  const fx = makeHarness();
  assert.throws(
    () => fx.confirm.commit({ projectRoot: "D:/work/manual", target: "T1", naming: [icon("MenuOk")] }),
    (error) => error.code === "NO_SOURCE",
    "没有来源运行要报 NO_SOURCE"
  );
  assert.deepStrictEqual(fx.calls, [], "没有来源就不去问运行管理器");
  assert.deepStrictEqual(fx.started, [], "没有来源不起运行");
}

// 给了那次运行：参数从它继承，锚点从它自己记的步骤里找。
function caseKnownRun() {
  const fx = makeHarness();
  const result = fx.confirm.commit({
    projectRoot: "D:/work/known",
    target: "T1",
    runId: "job-known",
    naming: [icon("MenuOk")]
  });
  assert.deepStrictEqual(fx.calls, ["job-known"], "只按给出的那次运行取");
  assert.strictEqual(result.mode, "mtslg-iocontrol", "路线继承来源运行");
  assert.strictEqual(result.resumedFrom, "ledger", "从消费刚写入文件的第 7 步续");
  assert.strictEqual(fx.started.length, 1, "续跑起一次新运行");
  assert.strictEqual(fx.started[0].projectRoot, "D:/work/known");
  assert.strictEqual(fx.started[0].fileId, "file-1", "设计稿参数来自来源运行");
  assert.strictEqual(fx.started[0].progress, "ledger");
}

// 那次运行已经被挤掉、也没带请求参数：只写入，不猜别的运行。
function caseStaleRun() {
  const fx = makeHarness();
  const result = fx.confirm.commit({
    projectRoot: "D:/work/gone",
    target: "T1",
    runId: "job-gone",
    naming: [icon("MenuOk")]
  });
  assert.deepStrictEqual(fx.calls, ["job-gone"], "只认给出的 id，不退回最近一次运行");
  assert.deepStrictEqual(fx.started, [], "参数不全就不起运行");
  assert.strictEqual(result.job, null);
  assert.match(result.note, /没有可续跑的上一次运行/, "把「只写入了」明说出来");
  assert.strictEqual(fx.written.length, 1, "文件照样写进去");
}

// 运行没了但调用方带着请求参数（看板自动补输入那条路）：按请求参数 + 步骤契约续。
function caseRequestFallback() {
  const fx = makeHarness();
  const result = fx.confirm.commit({
    projectRoot: "D:/work/known",
    target: "T1",
    runId: "job-gone",
    request: {
      projectRoot: "D:/work/known",
      target: "T1",
      fileId: "file-2",
      layerId: "layer-2",
      ui: "F2",
      mode: "mw-wpf",
      origin: "board"
    },
    naming: [icon("MenuOk")]
  });
  assert.strictEqual(result.resumedFrom, "ledger", "锚点改从步骤契约里按名字找");
  assert.strictEqual(fx.started.length, 1);
  assert.strictEqual(fx.started[0].fileId, "file-2", "参数来自调用方给的请求");
  assert.strictEqual(fx.started[0].ui, "F2");
  assert.strictEqual(fx.started[0].origin, "board", "看板任务续跑之后还是看板任务");
  assert.strictEqual(fx.started[0].progress, "ledger");
}

// 只写入：没有来源运行也能走，文件写进去、不起运行。
function caseWriteOnly() {
  const fx = makeHarness();
  const result = fx.confirm.commit({
    projectRoot: "D:/work/manual",
    target: "T1",
    naming: [icon("MenuOk")],
    resume: false
  });
  assert.strictEqual(result.job, null);
  assert.deepStrictEqual(fx.calls, [], "只写入不碰运行管理器");
  assert.deepStrictEqual(fx.started, []);
  assert.strictEqual(fx.written.length, 1);
}

/*
 * 空分组表也照写、也从 layout 续跑：那是显式声明「本页没有要声明的分组」。
 * 不写的话这一页永远解不开插件那条「有设计稿位图但没有分组表」。
 */
function caseEmptyGroups() {
  const fx = makeHarness();
  const result = fx.confirm.commit({
    projectRoot: "D:/work/known",
    target: "T1",
    runId: "job-known",
    groups: []
  });
  assert.deepStrictEqual(fx.written, [{ projectRoot: "D:/work/known", target: "T1", groups: [] }], "空数组照写");
  assert.strictEqual(result.resumedFrom, "layout", "从消费分组表的第 8 步续");
  assert.strictEqual(fx.started.length, 1);
  assert.strictEqual(fx.started[0].progress, "layout");
}

try {
  caseNoSource();
  console.log("  ok  没有来源运行就明说，不猜最近一次");
  caseKnownRun();
  console.log("  ok  按给出的那次运行继承参数与锚点");
  caseStaleRun();
  console.log("  ok  运行没了也没带参数：只写入，不猜");
  caseRequestFallback();
  console.log("  ok  运行没了但带着请求参数：从契约锚点续");
  caseWriteOnly();
  console.log("  ok  只写入不继续");
  caseEmptyGroups();
  console.log("  ok  空分组表照写（本页没有要声明的分组）");
  console.log("confirm-source.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
