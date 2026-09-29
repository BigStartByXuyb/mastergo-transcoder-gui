#!/usr/bin/env node
"use strict";

/*
 * 重启之后的续跑：运行管理器里的 job 只在内存里，客户端重启过、旧 job 被挤掉之后，
 * 这次运行的状态只剩看板任务自己的记录与插件在磁盘上的运行登记表。
 * 本文件盯住那条路：看板按登记表对表、按 jobId 找回任务、算得出从哪一步续。
 * 跑法：node tests/resume-after-restart.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBoard } = require("../lib/board.js");
const { createArtifacts } = require("../lib/artifacts.js");
const pageProgress = require("../lib/page-progress.js");

const LINK = "https://mastergo.com/goto/abc?file=204689197363903&layer_id=1872:60904";
// 契约里第 2 步生成 Bundle 清单：续跑回到它就是「已有这一页 → 重算清单」。
const CONTRACT = [
  { Id: 1, Name: "fetch", Title: "取数" },
  { Id: 2, Name: "bundle", Title: "生成 Bundle", Outputs: ["<Target>.bundle.json"] },
  { Id: 3, Name: "gates", Title: "门禁" },
  { Id: 4, Name: "verify", Title: "验证" }
];

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

// 插件自己的运行登记表：步骤就是这个页面**跨多次运行**推进到哪儿的记录。
function writeRegistry(workDir, target, steps) {
  write(
    path.join(workDir, "Generated", "runs", target, "run.json"),
    JSON.stringify({ runId: "r1", identity: { mode: "mtslg-iocontrol" }, updatedAt: "", steps: steps }, null, 2)
  );
}

// 假执行引擎：不认识任何旧 job，只记新的这次运行。
function stubRuns() {
  const started = [];
  return {
    started: started,
    start: function (request) {
      started.push(request);
      return { id: "job-new-" + started.length, state: "running", request: request };
    },
    status: function () {
      return null;
    },
    latestFor: function () {
      return null;
    },
    contract: function () {
      return CONTRACT;
    }
  };
}

// 第 2 步停在待命名：停点性质由插件产物判定，不由 GUI 猜步骤名。
function stubPending(needsNaming) {
  return {
    inspect: function () {
      return { icons: { available: true, needsNaming: needsNaming, needsRepair: false } };
    }
  };
}

function boardTask(overrides) {
  return Object.assign({
    id: "t-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    state: "failed",
    request: {
      mode: "B",
      link: LINK,
      target: "",
      ui: "F4",
      projectRoot: "",
      fileId: "204689197363903",
      layerId: "1872:60904",
      overwrite: true,
      allowEmptyLedger: false,
      stopAfter: ""
    },
    workDir: "",
    baseDir: "",
    jobId: "job-gone",
    autoMerge: false,
    failure: null,
    merge: null,
    error: "客户端重启，这个任务已中断"
  }, overrides);
}

// 「这一页推进到哪儿」的判据本身。
function casePageProgress() {
  const ok = function (name) { return { id: 1, name: name, status: "ok" }; };
  const bad = function (name) { return { id: 2, name: name, status: "failed" }; };

  assert.strictEqual(pageProgress.isComplete([ok("a")], 2), false, "步骤没跑满不算完");
  assert.strictEqual(pageProgress.isComplete([ok("a"), ok("b")], 2), true, "跑满且全 ok 才算完");
  assert.strictEqual(pageProgress.isComplete([ok("a"), bad("b")], 2), false, "有一步没成就没完");
  assert.strictEqual(pageProgress.isComplete([ok("a"), ok("b")], 0), false, "契约读不到时不猜跑完");
  assert.strictEqual(pageProgress.isComplete(null, 2), false, "没有登记表就是没跑过");

  assert.strictEqual(pageProgress.resumeStepOf([ok("a"), bad("b")]).name, "b", "续跑锚点是第一条没跑成的步骤");
  assert.strictEqual(pageProgress.resumeStepOf([ok("a")]), null, "全 ok 就没有锚点");
  assert.strictEqual(pageProgress.resumeStepOf(null), null, "没有登记表就没有锚点");

  assert.strictEqual(pageProgress.bundleManifestStep(CONTRACT), "bundle", "按契约 Outputs 认生成 Bundle 的那一步");
  assert.strictEqual(pageProgress.bundleManifestStep([{ Id: 1, Name: "fetch", Outputs: ["a.json"] }]), "", "契约里没有就空着");
  assert.strictEqual(pageProgress.bundleManifestStep(null), "", "没有契约就空着");
}

// 产物台账读的是插件登记表，不是自己扫目录。
function caseArtifacts(fx) {
  const artifacts = createArtifacts();
  assert.strictEqual(artifacts.read({ projectRoot: fx.project, target: "Nope" }).available, false, "没有登记表就不可用");

  const info = artifacts.read({ projectRoot: fx.workDone, target: "DonePage" });
  assert.strictEqual(info.available, true, "有登记表就可读");
  assert.strictEqual(info.steps.length, 4, "步骤取自登记表");
  assert.strictEqual(info.steps[0].name, "fetch");
  assert.strictEqual(info.project.length, 1, "只算真正落进工程的产物");
  assert.strictEqual(info.cleanedCount, 1, "已清理的中间件单独计数");
  assert.strictEqual(info.summary.todos.length, 1, "摘要里的待办照原样给出");
  assert.throws(function () { artifacts.read({ projectRoot: "", target: "" }); }, /工程目录/, "缺工程目录要拒绝");
}

// 看板快照每次都对一次表：登记表说跑完了，行上的失败就是过期的。
function caseReconcile(fx) {
  const board = fx.board(stubPending(true));

  const done = board.snapshot().tasks.find(function (item) { return item.id === "t-done"; });
  assert.strictEqual(done.state, "ready", "登记表跑满又全 ok，行要回到待合并");
  assert.strictEqual(done.failure, null, "失败信息不许留着");
  assert.strictEqual(done.error, "", "重启留下的错误文本要清掉");
  assert.strictEqual(done.progress.done, 4, "进度按登记表算");
  assert.strictEqual(done.progress.total, 4, "分母用契约");

  const partial = board.snapshot().tasks.find(function (item) { return item.id === "t-partial"; });
  assert.strictEqual(partial.state, "waiting", "停在待命名的那一步就是等语义输入，不是错误");
  assert.strictEqual(partial.failure.stepName, "bundle", "停点换成登记表里那一步");
  assert.strictEqual(partial.failure.title, "生成 Bundle", "标题取自步骤契约");
  assert.strictEqual(partial.failure.kind, "semantic", "停点性质按插件产物判");
  assert.ok(partial.failure.logPath.endsWith("_work\\steps\\02-bundle.log") || partial.failure.logPath.endsWith("_work/steps/02-bundle.log"), "日志路径指向停在那一步的那份");
}

// 人主动停下的任务不参与对表：它就是被停的，不该自己变成失败或完成。
function caseStopStaysStopped(fx) {
  const board = fx.board(stubPending(false));
  const stopped = board.snapshot().tasks.find(function (item) { return item.id === "t-stopped"; });
  assert.strictEqual(stopped.state, "stopped", "人停的就是停的");
  assert.strictEqual(stopped.error, "客户端重启，这个任务已中断", "原因保持原样");
}

// 旧 job 没了也能续：按 jobId 找回任务，从登记表算出锚点与参数。
function caseResumePlan(fx) {
  const board = fx.board(stubPending(true));
  board.snapshot();

  assert.strictEqual(board.findByJob("job-gone").id, "t-done", "按旧 jobId 也要能找回那一行");
  const found = board.findByJob("job-partial");
  assert.ok(found, "按旧 jobId 要能找回那一行");
  assert.strictEqual(found.id, "t-partial");

  const finished = board.planResume("t-done");
  assert.strictEqual(finished.finished, true, "跑完的页面没有可续的步骤");

  const plan = board.planResume("t-partial");
  assert.strictEqual(plan.finished, false);
  assert.strictEqual(plan.mode, "B", "路线继承原次运行");
  assert.strictEqual(plan.step, "bundle", "从第一条没跑成的步骤续");
  assert.strictEqual(plan.recomputedManifest, true, "锚点就是生成 Bundle 的那一步 → 重算清单");
  assert.strictEqual(plan.request.projectRoot, fx.workPartial, "工程目录用这次运行自己的工作目录");
  assert.strictEqual(plan.request.allowEmptyLedger, true, "空台账声明一并继承");
  assert.strictEqual(plan.request.origin, "board");
  assert.strictEqual(board.findByJob("不存在"), null, "空 jobId 找不到任何任务");
}

// 续跑起来之后把新 job 挂回那一行：行上的状态、日志、合并都跟着新运行走。
function caseAttach(fx) {
  const board = fx.board(stubPending(true));
  board.snapshot();
  board.attach("t-partial", { id: "job-new-1" });
  const after = board.snapshot().tasks.find(function (item) { return item.id === "t-partial"; });
  assert.strictEqual(after.jobId, "job-new-1", "新运行要挂到行上");
  assert.strictEqual(after.state, "running", "挂上之后这一行就是在跑");
  assert.strictEqual(board.findByJob("job-new-1").id, "t-partial", "反查跟着更新");
}

function main() {
  casePageProgress();
  console.log("  ok  页面进度的判据（跑完 / 锚点 / 生成 Bundle 那一步）");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-resume-test-"));
  try {
    const project = path.join(root, "project");
    const workDone = path.join(root, "work-done");
    const workPartial = path.join(root, "work-partial");
    const workStopped = path.join(root, "work-stopped");
    write(path.join(project, "demo.txt"), "demo\n");

    writeRegistry(workDone, "DonePage", [
      { id: 1, name: "fetch", status: "ok", seconds: 1, note: "" },
      { id: 2, name: "bundle", status: "ok", seconds: 1, note: "" },
      { id: 3, name: "gates", status: "ok", seconds: 1, note: "" },
      { id: 4, name: "verify", status: "ok", seconds: 1, note: "" }
    ]);
    write(
      path.join(workDone, "Generated", "DonePage.summary.json"),
      JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z", page: null, pageProduct: null, todos: ["命名表待补"], notices: [] })
    );
    write(
      path.join(workDone, "Generated", "runs", "DonePage", "run.json"),
      JSON.stringify({
        runId: "r1",
        identity: { mode: "mtslg-iocontrol" },
        updatedAt: "",
        steps: [
          { id: 1, name: "fetch", status: "ok", seconds: 1, note: "" },
          { id: 2, name: "bundle", status: "ok", seconds: 1, note: "" },
          { id: 3, name: "gates", status: "ok", seconds: 1, note: "" },
          { id: 4, name: "verify", status: "ok", seconds: 1, note: "" }
        ],
        outputs: {
          "Pages/DonePage.xml": { kind: "project", exists: true, sha256: "aa" },
          "Generated/_work/tmp.bin": { kind: "work", exists: false }
        }
      }, null, 2)
    );
    writeRegistry(workPartial, "PartPage", [
      { id: 1, name: "fetch", status: "ok", seconds: 1, note: "" },
      { id: 2, name: "bundle", status: "failed", seconds: 0, note: "命名表缺 3 个图标" },
      { id: 3, name: "gates", status: "pending", seconds: 0, note: "" }
    ]);
    writeRegistry(workStopped, "StopPage", [
      { id: 1, name: "fetch", status: "ok", seconds: 1, note: "" },
      { id: 2, name: "bundle", status: "pending", seconds: 0, note: "" }
    ]);

    const home = path.join(root, "home");
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      path.join(home, "board.json"),
      JSON.stringify([
        boardTask({
          id: "t-done",
          request: Object.assign(boardTask({}).request, { target: "DonePage", projectRoot: project }),
          workDir: workDone
        }),
        boardTask({
          id: "t-partial",
          request: Object.assign(boardTask({}).request, { target: "PartPage", projectRoot: project, allowEmptyLedger: true }),
          workDir: workPartial,
          jobId: "job-partial"
        }),
        boardTask({
          id: "t-stopped",
          state: "stopped",
          request: Object.assign(boardTask({}).request, { target: "StopPage", projectRoot: project }),
          workDir: workStopped,
          jobId: "job-stopped"
        })
      ], null, 2) + "\n"
    );

    const artifacts = createArtifacts();
    const fx = {
      project: project,
      workDone: workDone,
      workPartial: workPartial,
      board: function (pending) {
        // runs 每次重建：装着「进程刚起来、内存里一个 job 都没有」。
        return createBoard({ runs: stubRuns(), pending: pending, artifacts: artifacts, home: home });
      }
    };

    caseArtifacts(fx);
    console.log("  ok  产物台账读插件登记表");
    caseReconcile(fx);
    console.log("  ok  重启后按登记表对表");
    caseStopStaysStopped(fx);
    console.log("  ok  人停下的任务不参与对表");
    caseResumePlan(fx);
    console.log("  ok  旧 job 没了也能算出续跑计划");
    caseAttach(fx);
    console.log("  ok  续跑的新运行挂回看板行");
    console.log("resume-after-restart.test.js 全部通过");
  }
  finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
