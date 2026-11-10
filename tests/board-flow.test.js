#!/usr/bin/env node
"use strict";

// 看板任务的状态机：登记、启动（工作目录）、tick 同步（就绪/待确认/失败）、自动合并、停止/移除/清理、
// 进度与步骤视图、Target 认领。runs / pending / autoFill / artifacts 全部用桩，只有工作目录是真实现。
// 跑法：node tests/board-flow.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBoard } = require("../lib/board.js");
const designImage = require("../lib/design-image.js");
const { UserError } = require("../lib/errors.js");
const workdir = require("../lib/workdir.js");
const { png } = require("./image-fixtures.js");

const LINK = "https://mastergo.com/goto/x?file=204689197363903&layer_id=1872:60904";
const TICK = 1100;

const STEPS = [
  { Id: 6, Name: "discover", Title: "候选发现", Inputs: ["候选清单"], Outputs: ["x"], Failures: ["f"], Recovery: ["r"] },
  {
    Id: 7,
    Name: "ledger",
    Title: "图标台账",
    Inputs: ["图标台账 Generated/_inputs/<Target>.icon-naming.json（人工/AI 语义输入）"],
    Outputs: ["x"],
    Failures: ["f"],
    Recovery: ["r"]
  }
];

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-board-proj-"));
  write(path.join(root, "docs", "page-registry.json"), '{ "pages": [] }\n');
  write(path.join(root, "Resources", "Pages", "T1", "T1Page.xml"), "<IOContorl ID=\"a\" />\n");
  return root;
}

// 桩执行引擎：状态由测试逐条指定；步骤契约默认上面那一份，换契约的用例自己给。
function makeRuns(contract) {
  const jobs = new Map();
  const latest = new Map();
  const started = [];
  return {
    started: started,
    seed(id, job, projectRoot) {
      jobs.set(id, job);
      if (projectRoot) latest.set(projectRoot, job);
    },
    api: {
      start: (request) => {
        started.push(request);
        const id = "job-" + started.length;
        jobs.set(id, { id: id, state: "running", request: request, runs: [] });
        latest.set(request.projectRoot, jobs.get(id));
        return { id: id };
      },
      status: (id) => jobs.get(id) || null,
      latestFor: (projectRoot) => latest.get(projectRoot) || null,
      contract: () => contract || STEPS
    }
  };
}

function makeBoard(options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-board-home-"));
  const project = options.project || makeProject();
  const runs = makeRuns(options.steps);
  const pendingCalls = [];
  const autoFillCalls = [];
  const board = createBoard({
    runs: runs.api,
    pending: {
      inspect: (args) => {
        pendingCalls.push(args);
        if (options.pendingThrows) throw new Error("读不到清单");
        if (options.pendingFor) return options.pendingFor(args);
        return options.pending || { icons: { available: true, needsNaming: true, needsRepair: false, mustName: [1, 2] }, translations: { available: false } };
      }
    },
    merge: options.merge,
    autoFill: options.autoFill === undefined && options.autoFillThrows === undefined
      ? null
      : {
          fill: async () => {
            autoFillCalls.push(true);
            if (options.autoFillThrows) throw options.autoFillThrows;
            return options.autoFill;
          }
        },
    layout: { register: () => ({ ok: true }) },
    artifacts: options.artifacts || { stepsOf: () => [] },
    home: home
  });
  return { board, home, project, runs, pendingCalls, autoFillCalls };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 启动是异步的（要先把主工程复制进工作目录）：必须等 jobId 落下来再往下驱动，
// 否则会在 CI 上抢在 launch 之前写状态，被随后的真实 launch 覆盖。
async function waitForTask(board, id, predicate, label) {
  for (let index = 0; index < 100; index += 1) {
    const task = board.snapshot().tasks.find((item) => item.id === id);
    if (task && predicate(task)) return task;
    await sleep(50);
  }
  throw new Error("等超时：" + label);
}

const hasJob = (task) => Boolean(task.jobId);

function caseLoadMarksDeadTasksStopped() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-board-resume-"));
  const queuedId = "t3";
  const staged = designImage.stage({ home: home, taskId: queuedId, data: png(1280, 1024).toString("base64") });
  write(path.join(home, "board.json"), JSON.stringify([
    { id: "t1", state: "running", request: { projectRoot: "D:/p", link: LINK, target: "T" }, workDir: "D:/w" },
    { id: "t2", state: "merged", request: { projectRoot: "D:/p", link: LINK, target: "T" }, workDir: "D:/w" },
    {
      id: queuedId,
      state: "queued",
      deferStart: true,
      request: { projectRoot: "D:/p", link: LINK, target: "T" },
      workDir: ""
    }
  ]));
  const runs = makeRuns();
  const board = createBoard({ runs: runs.api, pending: null, artifacts: { stepsOf: () => [] }, home: home });
  const snapshot = board.snapshot();
  const states = snapshot.tasks.map((task) => task.state);
  assert.deepStrictEqual(states, ["stopped", "merged", "failed"], "重启后不可能还在跑，未完成延后启动的任务要有明确终态");
  const deferred = snapshot.tasks.find((task) => task.id === queuedId);
  assert.match(deferred.error, /任务创建与显式启动之间/, "延后启动窗口被打断时给出明确原因");
  assert.ok(!fs.existsSync(staged.path), "无法恢复的延后任务同时清掉暂存件");
  fs.rmSync(home, { recursive: true, force: true });
}

function caseAddValidationAndFields() {
  const fx = makeBoard();
  assert.throws(() => fx.board.add({ projectRoot: "  ", items: [{ link: LINK }] }), (error) => error.code === "NEED_PROJECT");
  assert.throws(() => fx.board.add({ projectRoot: "D:/missing-dir-xyz", items: [{ link: LINK }] }), (error) => error.code === "NO_PROJECT");
  assert.throws(() => fx.board.add({ projectRoot: fx.project, items: [] }), (error) => error.code === "NO_ITEMS");
  assert.throws(() => fx.board.add({ projectRoot: fx.project, items: [{ link: "https://x" }] }), (error) => error.code === "BAD_LINK");

  const added = fx.board.add({
    projectRoot: fx.project,
    ui: "F3",
    stopAfter: "discover",
    overwrite: true,
    autoMerge: false,
    items: [
      { link: LINK, target: "T1", mode: "A" },
      { link: LINK + "&x=1", target: "T2" }
    ]
  });
  assert.strictEqual(added.created.length, 2);
  const first = added.board.tasks.find((task) => task.id === added.created[0]);
  assert.strictEqual(first.state, "queued");
  assert.strictEqual(first.stateLabel, "排队中");
  assert.strictEqual(first.request.ui, "F3");
  assert.strictEqual(first.request.stopAfter, "discover");
  assert.strictEqual(first.request.overwrite, true);
  assert.strictEqual(first.request.mode, "A", "item 上的路线优先");
  assert.strictEqual(first.request.fileId, "204689197363903");
  assert.strictEqual(first.autoMerge, false);
  const second = added.board.tasks.find((task) => task.id === added.created[1]);
  assert.strictEqual(second.request.mode, "B", "item 没给路线时用默认");
  fs.rmSync(fx.home, { recursive: true, force: true });
}

async function caseStartUsesWorkDirAndKeepsQueue() {
  const fx = makeBoard();
  const items = [];
  for (let index = 0; index < 6; index += 1) items.push({ link: LINK + "&i=" + index, target: "T" + index, mode: "B" });
  const added = fx.board.add({ projectRoot: fx.project, items: items });
  fx.board.start(added.created[0]);
  const first = await waitForTask(fx.board, added.created[0], hasJob, "第一个任务启动完成");
  assert.ok(first.workDir && first.workDir.startsWith(path.join(fx.home, "work")), "任务在自己的工作目录里跑");
  assert.ok(fs.existsSync(path.join(first.workDir, "docs", "page-registry.json")), "工作目录是主工程的副本");
  assert.strictEqual(fx.runs.started[0].projectRoot, first.workDir, "执行引擎的 -ProjectRoot 是工作目录");
  assert.strictEqual(fx.runs.started[0].origin, "board");
  assert.strictEqual(fx.runs.started[0].mode, "B");

  fx.board.start();
  // launch() 在第一个 await 之前就把状态置成 preparing：这里不需要再等固定时间，
  // 排队与否只取决于并发上限，不取决于时间。
  await sleep(50);
  const limit = fx.board.snapshot().limits.limit;
  const occupying = fx.board.snapshot().tasks.filter((task) => ["preparing", "running", "merging"].includes(task.state));
  assert.ok(occupying.length <= limit, "并发不超过按核数算出来的上限，实际 " + occupying.length + " / " + limit);
  assert.ok(fx.board.snapshot().tasks.some((task) => task.state === "queued"), "超出上限的任务留在队列里");
  assert.throws(() => fx.board.start(added.created[0]), (error) => error.code === "NOT_QUEUED", "只有排队中的任务能被启动");
  fs.rmSync(fx.home, { recursive: true, force: true });
}

async function caseDeferredTaskWaitsForExplicitStart() {
  const fx = makeBoard();
  const live = fx.board.add({ projectRoot: fx.project, items: [{ link: LINK, target: "Live", mode: "B" }] });
  fx.board.start(live.created[0]);
  const liveTask = await waitForTask(fx.board, live.created[0], hasJob, "先有一条运行中的任务");
  fx.runs.seed(liveTask.jobId, { id: liveTask.jobId, state: "running", request: {}, runs: [] }, liveTask.workDir);

  const added = fx.board.add({
    projectRoot: fx.project,
    deferStart: true,
    items: [{ link: LINK + "&deferred=1", target: "Deferred", mode: "A" }]
  });
  await sleep(TICK * 2 + 300);
  const deferred = fx.board.snapshot().tasks.find((item) => item.id === added.created[0]);
  assert.strictEqual(deferred.state, "queued", "tick 不得抢跑等页面 PNG 暂存的新任务");
  assert.strictEqual(deferred.jobId, "", "还没有工作目录与运行");

  fx.board.start(added.created[0]);
  await waitForTask(fx.board, added.created[0], hasJob, "暂存完成后显式启动");
  fs.rmSync(fx.home, { recursive: true, force: true });
}

async function caseStartAllKeepsDeferredTasks() {
  const fx = makeBoard();
  const deferred = fx.board.add({
    projectRoot: fx.project,
    deferStart: true,
    items: [{ link: LINK + "&deferred-all=1", target: "Deferred", mode: "A" }]
  });
  const regular = fx.board.add({
    projectRoot: fx.project,
    items: [{ link: LINK + "&regular-all=1", target: "Regular", mode: "B" }]
  });

  fx.board.start();
  await waitForTask(fx.board, regular.created[0], hasJob, "启动全部先启动未延后的任务");
  const stillWaiting = fx.board.snapshot().tasks.find((task) => task.id === deferred.created[0]);
  assert.strictEqual(stillWaiting.state, "queued", "启动全部不得越过页面 PNG 暂存门禁");
  assert.strictEqual(stillWaiting.jobId, "", "延后任务还没跑");

  fx.board.stop(regular.created[0]);
  fs.rmSync(fx.home, { recursive: true, force: true });
}

async function caseTickSyncsReadyAndMerges() {
  const fx = makeBoard();
  const added = fx.board.add({ projectRoot: fx.project, items: [{ link: LINK, target: "T1", mode: "B" }] });
  const id = added.created[0];
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, '启动完成');
  fx.runs.seed(task.jobId, { id: task.jobId, state: "done", request: {}, runs: [] }, task.workDir);

  await sleep(TICK + 300);
  const after = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.ok(["merged", "conflict"].includes(after.state), "跑完之后自动合并或者停在冲突，实际：" + after.state);
  if (after.state === "merged") {
    assert.ok(after.merge && after.merge.applied.length >= 0);
  }
  else {
    assert.ok(after.error, "冲突/合并失败要给出原因");
  }
  fs.rmSync(fx.home, { recursive: true, force: true });
}

async function caseSemanticStopAndAutoFill() {
  const fx = makeBoard({ autoFill: { ok: true, filled: ["MenuOk"], job: { id: "job-resumed", request: { progress: "ledger" } } } });
  const added = fx.board.add({ projectRoot: fx.project, ui: "F3", items: [{ link: LINK, target: "T1", mode: "B" }] });
  const id = added.created[0];
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, '启动完成');
  fx.runs.seed(task.jobId, {
    id: task.jobId,
    state: "failed",
    request: {},
    runs: [{
      mode: "mtslg-iocontrol",
      label: "B",
      state: "failed",
      failure: { stepId: 7, stepName: "ledger", message: "缺少命名表", resume: "", detail: "" },
      steps: {}
    }]
  }, task.workDir);

  await sleep(TICK + 300);
  const after = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(after.state, "waiting", "停点等人/AI 补输入时是待确认，不是失败");
  assert.strictEqual(after.failure.kind, "semantic");
  assert.ok(fx.pendingCalls.length > 0, "要按插件产物判断是不是语义停点");
  assert.ok(fx.autoFillCalls.length > 0, "自动化层级允许时要尝试自动补输入");
  assert.ok(after.aiFills.length > 0, "补进去的内容记在消费它的那一步上");
  assert.strictEqual(after.aiFills[0].stepName, "ledger");
  assert.strictEqual(after.aiFills[0].stepTitle, "图标台账");
  fs.rmSync(fx.home, { recursive: true, force: true });
}

/*
 * 这一步的输入自己读不出来（例如位图坏了）：整句写在行上（含怎么做），并且不占自动补输入的额度 ——
 * 「补不了」与「模型补不出来」是两件事，前者等人换输入。
 */
async function caseAutoFillBlockedByInput() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-board-blocked-"));
  const project = makeProject();
  const runs = makeRuns();
  const id = "task-blocked-input";
  const reason = "这一页那张页面 PNG 读不出格式：重新导出成 PNG / JPEG 再传一张。";
  write(path.join(home, "board.json"), JSON.stringify([{
    id: id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: "queued",
    request: { mode: "B", link: LINK, target: "T1", ui: "F3", projectRoot: project, fileId: "204689197363903", layerId: "1872:60904", overwrite: false, allowEmptyLedger: false, stopAfter: "" },
    workDir: "",
    baseDir: "",
    jobId: "",
    autoMerge: false,
    autoFillCount: 0,
    failure: null,
    merge: null,
    error: ""
  }]));
  const board = createBoard({
    runs: runs.api,
    pending: { inspect: () => ({ icons: { available: true, needsNaming: true, needsRepair: false, mustName: [1] }, translations: { available: false } }) },
    autoFill: { fill: async () => ({ ok: false, blocked: true, reason: reason }) },
    layout: { register: () => ({ ok: true }) },
    artifacts: { stepsOf: () => [] },
    home: home
  });
  board.start(id);
  const task = await waitForTask(board, id, hasJob, '启动完成');
  runs.seed(task.jobId, {
    id: task.jobId,
    state: "failed",
    request: {},
    runs: [{ mode: "mtslg-iocontrol", label: "B", state: "failed", failure: { stepId: 7, stepName: "ledger", message: "缺少命名表", resume: "", detail: "" }, steps: {} }]
  }, task.workDir);
  await sleep(TICK + 300);
  const after = board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(after.state, "waiting");
  assert.strictEqual(after.error, reason, "整句（含怎么做）写在行上");
  const stored = JSON.parse(fs.readFileSync(path.join(home, "board.json"), "utf8"));
  assert.strictEqual(stored[0].autoFillCount, 0, "没到模型那一步：不占自动补输入的额度");
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}

/* 抛出来的错误也带修法：整句（原因 + 怎么做）的拼法只有一处（lib/errors.js 的 failureSentence）。 */
async function caseAutoFillThrownErrorKeepsHint() {
  const thrown = new UserError("AI_CALL", "调用模型失败（HTTP 500）", "换一个模型或稍后再点一次");
  const fx = makeBoard({ autoFillThrows: thrown });
  const added = fx.board.add({ projectRoot: fx.project, ui: "F3", items: [{ link: LINK, target: "T1", mode: "B" }] });
  const id = added.created[0];
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, '启动完成');
  fx.runs.seed(task.jobId, {
    id: task.jobId,
    state: "failed",
    request: {},
    runs: [{ mode: "mtslg-iocontrol", label: "B", state: "failed", failure: { stepId: 7, stepName: "ledger", message: "缺少命名表", resume: "", detail: "" }, steps: {} }]
  }, task.workDir);
  await sleep(TICK + 300);
  const after = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(after.error, thrown.message + "：" + thrown.hint, "行上那句要给全：原因 + 怎么做");
  fs.rmSync(fx.home, { recursive: true, force: true });
}

async function caseAutoFillLimitAndRealFailure() {
  // 补输入次数已经在盘上顶到上限：下一次停在语义停点时要交回给人，而不是继续补。
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-board-limit-"));
  const project = makeProject();
  const runs = makeRuns();
  const id = "task-at-limit";
  write(path.join(home, "board.json"), JSON.stringify([{
    id: id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: "queued",
    request: { mode: "B", link: LINK, target: "T1", ui: "F3", projectRoot: project, fileId: "204689197363903", layerId: "1872:60904", overwrite: false, allowEmptyLedger: false, stopAfter: "" },
    workDir: "",
    baseDir: "",
    jobId: "",
    autoMerge: false,
    autoFillCount: 4,
    failure: null,
    merge: null,
    error: ""
  }]));
  const board = createBoard({
    runs: runs.api,
    pending: { inspect: () => ({ icons: { available: true, needsNaming: true, needsRepair: false, mustName: [1] }, translations: { available: false } }) },
    autoFill: { fill: async () => ({ ok: true, filled: [], job: { id: "job-resumed", request: { progress: "" } } }) },
    layout: { register: () => ({ ok: true }) },
    artifacts: { stepsOf: () => [] },
    home: home
  });
  board.start(id);
  const task = await waitForTask(board, id, hasJob, '启动完成');
  runs.seed(task.jobId, {
    id: task.jobId,
    state: "failed",
    request: {},
    runs: [{ mode: "mtslg-iocontrol", label: "B", state: "failed", failure: { stepId: 7, stepName: "ledger", message: "缺少命名表", resume: "", detail: "" }, steps: {} }]
  }, task.workDir);
  await sleep(TICK + 300);
  const after = board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(after.state, "waiting");
  assert.match(after.error, /自动补输入已到上限/, "补到上限要交回给人，并说明原因");
  fs.rmSync(home, { recursive: true, force: true });

  // 真的失败（pending 读不到、契约也不认这个停点）→ failed
  const fx2 = makeBoard({ pendingThrows: true });
  const added2 = fx2.board.add({ projectRoot: fx2.project, items: [{ link: LINK, target: "T1", mode: "B" }] });
  fx2.board.start(added2.created[0]);
  const task2 = await waitForTask(fx2.board, added2.created[0], hasJob, '启动完成');
  fx2.runs.seed(task2.jobId, {
    id: task2.jobId,
    state: "failed",
    request: {},
    runs: [{ mode: "mtslg-iocontrol", label: "B", state: "failed", failure: { stepId: 1, stepName: "fetch", message: "登记表有多条页面", resume: "", detail: "" }, steps: {} }]
  }, task2.workDir);
  await sleep(TICK + 300);
  const after2 = fx2.board.snapshot().tasks.find((item) => item.id === added2.created[0]);
  assert.strictEqual(after2.state, "failed");
  assert.strictEqual(after2.failure.kind, "error");
  fs.rmSync(fx2.home, { recursive: true, force: true });

  /*
   * 清单读不到时退回契约：失败的那一步在契约里吃人/AI 写的输入文件（这里是第 7 步 ledger），
   * 就按「等语义输入」算，交回给人去那一步补 —— 不走「真失败」那条路。
   */
  const fx3 = makeBoard({ pendingThrows: true });
  const added3 = fx3.board.add({ projectRoot: fx3.project, items: [{ link: LINK, target: "T1", mode: "B" }] });
  fx3.board.start(added3.created[0]);
  const task3 = await waitForTask(fx3.board, added3.created[0], hasJob, "启动完成");
  fx3.runs.seed(task3.jobId, {
    id: task3.jobId,
    state: "failed",
    request: {},
    runs: [{ mode: "mtslg-iocontrol", label: "B", state: "failed", failure: { stepId: 7, stepName: "ledger", message: "台账不合格", resume: "", detail: "" }, steps: {} }]
  }, task3.workDir);
  await sleep(TICK + 300);
  const after3 = fx3.board.snapshot().tasks.find((item) => item.id === added3.created[0]);
  assert.strictEqual(after3.state, "waiting", "吃人/AI 输入的那一步失败＝停点，不是真失败");
  assert.strictEqual(after3.failure.kind, "semantic");
  fs.rmSync(fx3.home, { recursive: true, force: true });
}

/*
 * 新建任务时先选的页面 PNG：跑到「取数 + 固化快照」之后核对尺寸 —— 对不上就在任务行上写一句
 * （两个尺寸都写出来），条件解除之后自己清掉。这条提示不占 task.error，也不每个 tick 重复落盘。
 */
async function caseStagedImageNotice() {
  const project = makeProject();
  // 画板 1280×1024 的快照：主工程里这一份会随工作目录一起复制过去（插件在「取数 + 固化快照」那一步产出它）。
  write(
    path.join(project, "Generated", "runs", "T1", "dsl.snapshot.json"),
    JSON.stringify({ dsl: { nodes: [{ type: "FRAME", id: "1:1", layoutStyle: { width: 1280, height: 1024 } }] } })
  );
  const fx = makeBoard({ project: project });
  const added = fx.board.add({ projectRoot: project, items: [{ link: LINK, target: "T1", mode: "A" }] });
  const id = added.created[0];
  // 先选的那张图比画板矮 1 像素：落地时会被拦下。
  const staged = designImage.stage({ home: fx.home, taskId: id, data: png(1280, 1023).toString("base64") });
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, "启动完成");

  await sleep(TICK + 300);
  const mismatched = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.match(mismatched.designImage, /与画板尺寸不一致：图 1280×1023，画板 1280×1024/);
  assert.strictEqual(mismatched.error, "", "这条提示不是任务的失败原因（不占 error）");

  // 结果没变的 tick 不再落盘：任务还在跑，这一段时间里只有这一处会写 board.json。
  const store = path.join(fx.home, "board.json");
  const before = fs.statSync(store).mtimeMs;
  await sleep(TICK * 2 + 300);
  assert.strictEqual(fs.statSync(store).mtimeMs, before, "同一句话不再每个 tick 重写一遍");

  // 按原尺寸重导一张、在任务详情那一步重新传一次：下一 tick 装进工作目录，并把提示清掉。
  designImage.stage({ home: fx.home, taskId: id, data: png(1280, 1024).toString("base64") });
  await sleep(TICK + 300);
  const fixed = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(fixed.designImage, "", "条件解除后提示自己清掉");
  assert.ok(designImage.read({ projectRoot: task.workDir, target: "T1" }).matches, "合格的图装进了工作目录");
  assert.ok(!fs.existsSync(staged.path), "落地之后暂存件删掉");

  fs.rmSync(fx.home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}

/*
 * A 路线跑完后唯一允许进入待合并的前提，是工作目录里已有与 DSL 画板同尺寸的页面 PNG。
 * 没有图时 task.designImage 不能代替输入事实，更不能自动合并。
 */
async function casePipelineARequiresImageBeforeReady() {
  const project = makeProject();
  write(
    path.join(project, "Generated", "runs", "T1", "dsl.snapshot.json"),
    JSON.stringify({ dsl: { nodes: [{ type: "FRAME", id: "1:1", layoutStyle: { width: 1280, height: 1024 } }] } })
  );
  const fx = makeBoard({ project: project });
  const added = fx.board.add({
    projectRoot: project,
    autoMerge: true,
    items: [{ link: LINK, target: "T1", mode: "A" }]
  });
  const id = added.created[0];
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, "启动完成");
  fx.runs.seed(task.jobId, { id: task.jobId, state: "done", request: {}, runs: [] }, task.workDir);

  await sleep(TICK + 300);
  const after = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(after.state, "waiting", "没有页面 PNG 的 A 任务不得进入待合并");
  assert.strictEqual(after.failure.kind, "semantic");
  assert.match(after.failure.message, /含 A 的路线需要页面 PNG/);
  assert.strictEqual(after.error, "", "页面 PNG 是可补齐的语义停点，不是运行错误");
  const waitingAt = after.updatedAt;
  const store = path.join(fx.home, "board.json");
  const storeMtime = fs.statSync(store).mtimeMs;
  await sleep(TICK * 2 + 300);
  const stable = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(stable.updatedAt, waitingAt, "同一个等图停点不刷新更新时间");
  assert.strictEqual(fs.statSync(store).mtimeMs, storeMtime, "同一个等图停点不重写 board.json");

  designImage.stage({ home: fx.home, taskId: id, data: png(1280, 1023).toString("base64") });
  await sleep(TICK + 300);
  const mismatched = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(mismatched.state, "waiting", "尺寸不符同样不得进入待合并");
  assert.match(mismatched.failure.message, /与画板尺寸不一致：图 1280×1023，画板 1280×1024/);

  const stored = JSON.parse(fs.readFileSync(path.join(fx.home, "board.json"), "utf8"));
  assert.strictEqual(stored[0].state, "waiting", "等图状态先落盘，不能只改内存");
  assert.match(stored[0].failure.message, /含 A 的路线需要页面 PNG|页面 PNG 与画板尺寸不一致/);

  // 模拟进程重启：磁盘上原本还在运行的旧状态会被 load 改成 stopped，
  // 登记表即使显示全部完成，也必须重新经过页面 PNG 门禁。
  stored[0].state = "running";
  stored[0].jobId = "";
  stored[0].error = "自动补输入已到上限";
  write(path.join(fx.home, "board.json"), JSON.stringify(stored, null, 2) + "\n");
  const restarted = createBoard({
    runs: makeRuns().api,
    pending: null,
    artifacts: {
      stepsOf: () => [
        { id: 6, name: "discover", status: "ok", seconds: 1, note: "" },
        { id: 7, name: "ledger", status: "ok", seconds: 1, note: "" }
      ]
    },
    home: fx.home
  });
  const afterRestart = restarted.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(afterRestart.state, "waiting", "重启对表不得绕过页面 PNG 门禁");
  assert.match(afterRestart.failure.message, /页面 PNG/);
  assert.strictEqual(afterRestart.error, "", "进入等图停点要清掉旧错误，任务行只显示当前结论");

  fs.rmSync(fx.home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}

async function caseLayoutRerunsAfterProgressWhenImageNeedsGroups() {
  const project = makeProject();
  write(
    path.join(project, "Generated", "runs", "T1", "dsl.snapshot.json"),
    JSON.stringify({ dsl: { nodes: [{ type: "FRAME", id: "1:1", layoutStyle: { width: 1280, height: 1024 } }] } })
  );
  write(
    path.join(project, "Generated", "_inputs", "T1.layout-group-candidates.json"),
    JSON.stringify({ schemaVersion: "mw-wpf-layout-group-candidates/1", pageTarget: "T1", entries: [{ ref: "a" }, { ref: "b" }] })
  );
  const steps = [
    contractStep({ Id: 8, Name: "layoutManifest", Title: "Layout 清单", Inputs: ["分组表 Generated/_inputs/<Target>.layout-groups.json"] })
  ];
  const fx = makeBoard({ project: project, steps: steps });
  const id = fx.board.add({
    projectRoot: project,
    autoMerge: false,
    items: [{ link: LINK, target: "T1", mode: "A" }]
  }).created[0];
  const staged = designImage.stage({ home: fx.home, taskId: id, data: png(1280, 1024).toString("base64") });
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, "任务启动");
  designImage.installStaged({ home: fx.home, taskId: id, target: "T1", workDir: task.workDir });
  assert.ok(!fs.existsSync(staged.path), "页面 PNG 已落地");
  fx.runs.seed(task.jobId, {
    id: task.jobId,
    state: "done",
    request: { progress: "layoutManifest", stopAfter: "" },
    runs: []
  }, task.workDir);

  await sleep(TICK + 300);
  assert.ok(fx.runs.started.some((request) => request.progress === "layoutManifest"),
    "即使本次运行本身就是从布局续起，只要当前页面 PNG 缺分组表也要重推");

  const stored = JSON.parse(fs.readFileSync(path.join(fx.home, "board.json"), "utf8"));
  stored[0].state = "running";
  stored[0].jobId = "";
  write(path.join(fx.home, "board.json"), JSON.stringify(stored, null, 2) + "\n");
  const restartedRuns = makeRuns(steps);
  const restarted = createBoard({
    runs: restartedRuns.api,
    pending: null,
    layout: { register: () => ({ ok: true }) },
    artifacts: { stepsOf: () => [{ id: 8, name: "layoutManifest", status: "ok", seconds: 1, note: "" }] },
    home: fx.home
  });
  const restartedTask = restarted.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(restartedTask.state, "running", "重启对表后缺分组表也要重新进入运行");
  assert.ok(restartedRuns.started.some((request) => request.progress === "layoutManifest"),
    "运行已丢失时也要按当前页面 PNG 重推布局，不能直接待合并");
  const resumed = restarted.byId(id);
  write(workdir.layoutGroupsPath(resumed.workDir, "T1"), '{ "groups": [] }\n');
  restartedRuns.seed(
    resumed.jobId,
    { id: resumed.jobId, state: "done", request: { progress: "layoutManifest", stopAfter: "" }, runs: [] },
    resumed.workDir
  );
  await sleep(TICK + 300);
  assert.strictEqual(
    restarted.snapshot().tasks.find((item) => item.id === id).state,
    "ready",
    "重启后补起的布局运行必须继续被 tick 跟到收尾"
  );

  fs.rmSync(fx.home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}

async function caseBRealFailureIsNotReclassifiedByLayout() {
  const project = makeProject();
  const fx = makeBoard({
    project: project,
    pendingFor: (query) => ({
      icons: { available: false },
      translations: { available: false },
      layout: { needsGroups: query.mode !== "B", waiting: query.mode === "B" ? 0 : 1 }
    })
  });
  const id = fx.board.add({
    projectRoot: project,
    items: [{ link: LINK, target: "T1", mode: "B" }]
  }).created[0];
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, "B 任务启动");
  fx.runs.seed(task.jobId, {
    id: task.jobId,
    state: "failed",
    request: {},
    runs: [{
      state: "failed",
      steps: {},
      failure: { stepName: "not-human", message: "B 的真实失败" }
    }]
  }, task.workDir);
  await sleep(TICK + 300);
  const after = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(after.state, "failed", "B 不消费布局分组，真实失败不能被改判成待确认");
  assert.ok(fx.pendingCalls.some((call) => call.mode === "B"), "看板判停点必须把任务的 mode 交给同一份清单");
  fs.rmSync(fx.home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}

async function caseBadImageStopsBeforeLayoutRerun() {
  const project = makeProject();
  write(
    path.join(project, "Generated", "runs", "T1", "dsl.snapshot.json"),
    JSON.stringify({ dsl: { nodes: [{ type: "FRAME", id: "1:1", layoutStyle: { width: 1280, height: 1024 } }] } })
  );
  write(
    path.join(project, "Generated", "_inputs", "T1.layout-group-candidates.json"),
    JSON.stringify({ schemaVersion: "mw-wpf-layout-group-candidates/1", pageTarget: "T1", entries: [{ ref: "a" }, { ref: "b" }] })
  );
  const steps = [
    contractStep({ Id: 8, Name: "layoutManifest", Title: "Layout 清单", Inputs: ["分组表 Generated/_inputs/<Target>.layout-groups.json"] })
  ];
  const fx = makeBoard({ project: project, steps: steps });
  const id = fx.board.add({ projectRoot: project, items: [{ link: LINK, target: "T1", mode: "A" }] }).created[0];
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, "任务启动");
  write(path.join(workdir.inputsDir(task.workDir), "T1.design.png"), png(1280, 1023));
  const before = fx.runs.started.length;
  fx.runs.seed(task.jobId, { id: task.jobId, state: "done", request: { stopAfter: "" }, runs: [] }, task.workDir);

  await sleep(TICK + 300);
  const after = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(after.state, "waiting", "坏图先停在页面 PNG 核对点");
  assert.match(after.failure.message, /与画板尺寸不一致：图 1280×1023，画板 1280×1024/);
  assert.strictEqual(fx.runs.started.length, before, "页面 PNG 不合格时不得先重启布局");

  fs.rmSync(fx.home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}

function caseUnsafeImageIdentityStopsInsteadOfThrowing() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-board-home-"));
  const project = makeProject();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "gui-board-work-"));
  write(path.join(home, "board.json"), JSON.stringify([{
    id: "t-unsafe",
    state: "stopped",
    request: {
      mode: "A",
      link: LINK,
      target: "../Unsafe",
      projectRoot: project,
      stopAfter: "",
      overwrite: true
    },
    workDir: workDir,
    jobId: "",
    autoMerge: false,
    failure: null,
    error: "客户端重启，这个任务已中断"
  }], null, 2) + "\n");
  const steps = [
    contractStep({ Id: 8, Name: "layoutManifest", Title: "Layout 清单", Inputs: ["分组表 Generated/_inputs/<Target>.layout-groups.json"] })
  ];
  const runs = makeRuns(steps);
  const board = createBoard({
    runs: runs.api,
    pending: null,
    layout: { register: () => ({ ok: true }) },
    artifacts: { stepsOf: () => [{ id: 8, name: "layoutManifest", status: "ok", seconds: 1, note: "" }] },
    home: home
  });
  let snapshot;
  assert.doesNotThrow(() => { snapshot = board.snapshot(); }, "不合规页面身份不能从看板轮询里逸出");
  const task = snapshot.tasks.find((item) => item.id === "t-unsafe");
  assert.strictEqual(task.state, "waiting");
  assert.match(task.failure.message, /无法核对页面 PNG/);
  assert.strictEqual(runs.started.length, 0, "页面身份读不出来时不得重推布局");

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
}

async function caseMergingDoesNotRestartLayout() {
  const project = makeProject();
  write(
    path.join(project, "Generated", "runs", "T1", "dsl.snapshot.json"),
    JSON.stringify({ dsl: { nodes: [{ type: "FRAME", id: "1:1", layoutStyle: { width: 1280, height: 1024 } }] } })
  );
  write(
    path.join(project, "Generated", "_inputs", "T1.layout-group-candidates.json"),
    JSON.stringify({ schemaVersion: "mw-wpf-layout-group-candidates/1", pageTarget: "T1", entries: [{ ref: "a" }, { ref: "b" }] })
  );
  const steps = [
    contractStep({ Id: 8, Name: "layoutManifest", Title: "Layout 清单", Inputs: ["分组表 Generated/_inputs/<Target>.layout-groups.json"] })
  ];
  let releaseMerge = null;
  const fx = makeBoard({
    project: project,
    steps: steps,
    merge: {
      merge: () => new Promise((resolve) => {
        releaseMerge = () => resolve({ applied: [], skipped: [], notes: [], conflicts: [] });
      })
    }
  });
  const id = fx.board.add({ projectRoot: project, autoMerge: false, items: [{ link: LINK, target: "T1", mode: "A" }] }).created[0];
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, "任务启动");
  write(path.join(workdir.inputsDir(task.workDir), "T1.design.png"), png(1280, 1024));
  write(workdir.layoutGroupsPath(task.workDir, "T1"), '{ "groups": [] }\n');
  fx.runs.seed(task.jobId, { id: task.jobId, state: "done", request: { stopAfter: "" }, runs: [] }, task.workDir);
  await sleep(TICK + 300);
  assert.strictEqual(fx.board.snapshot().tasks.find((item) => item.id === id).state, "ready");

  try {
    fx.board.mergeOne(id);
    assert.strictEqual(fx.board.snapshot().tasks.find((item) => item.id === id).state, "merging");
    assert.strictEqual(
      fx.board.imageWriteBlock({ id: id, workDir: task.workDir, target: "T1" }),
      "任务正在合并，结束后才能换图。"
    );
    assert.throws(
      () => fx.board.requireImageWrite({ id: id, workDir: task.workDir, target: "T1" }),
      (error) => error.code === "TASK_MERGING"
    );
    assert.throws(
      () => fx.board.requireImageStage(id),
      (error) => error.code === "TASK_MERGING"
    );
    fs.rmSync(path.join(workdir.inputsDir(task.workDir), "T1.design.png"), { force: true });
    const staged = designImage.stage({ home: fx.home, taskId: id, data: png(1280, 1024).toString("base64") });
    fs.rmSync(workdir.layoutGroupsPath(task.workDir, "T1"), { force: true });
    const before = fx.runs.started.length;
    await sleep(TICK + 300);
    const after = fx.board.snapshot().tasks.find((item) => item.id === id);
    assert.strictEqual(after.state, "merging", "合并期间状态不被布局重跑覆盖");
    assert.strictEqual(fx.runs.started.length, before, "合并期间不启动新的布局运行");
    assert.ok(fs.existsSync(staged.path), "合并期间暂存件不落地");
    assert.strictEqual(designImage.read({ projectRoot: task.workDir, target: "T1" }).image, null,
      "合并期间不写工作目录");
  }
  finally {
    if (releaseMerge) releaseMerge();
  }

  fs.rmSync(fx.home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
}

/*
 * 「哪一步吃布局输入」按契约的 Inputs 判，不看步骤名：契约里叫 layout 的那一步若不吃分组表，
 * 界面就不会把位图恢复入口挂到别的步骤上（另有一个 decoy 故意叫这个名字）。
 */
function contractStep(detail) {
  return { Outputs: ["x"], Failures: ["f"], Recovery: ["r"], Inputs: [], ...detail };
}

async function caseLayoutStepComesFromContract() {
  const steps = [
    contractStep({ Id: 3, Name: "layout", Title: "另一步", Inputs: ["dsl.snapshot.json"] }),
    contractStep({ Id: 7, Name: "ledger", Title: "图标台账", Inputs: ["命名表 Generated/_inputs/<Target>.icon-naming.json"] }),
    contractStep({ Id: 8, Name: "layoutManifest", Title: "Layout 清单", Inputs: ["分组表 Generated/_inputs/<Target>.layout-groups.json"] })
  ];
  const artifacts = {
    stepsOf: () => [
      { id: 3, name: "layout", status: "ok", seconds: 1, note: "" },
      { id: 7, name: "ledger", status: "ok", seconds: 1, note: "" },
      { id: 8, name: "layoutManifest", status: "ok", seconds: 1, note: "" }
    ]
  };
  const fx = makeBoard({ steps: steps, artifacts: artifacts });
  const added = fx.board.add({ projectRoot: fx.project, items: [{ link: LINK, target: "T1", mode: "A" }] });
  const id = added.created[0];
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, "启动完成");
  const byName = new Map(task.steps.map((step) => [step.name, step]));
  assert.strictEqual(task.layoutStep, "layoutManifest", "吃分组表的那一步就是布局那一步（叫 layout 的那一步不算）");
  assert.strictEqual(byName.get("ledger").humanInput, true, "吃命名表那一步标自动语义输入");
  assert.strictEqual(byName.get("layoutManifest").humanInput, true, "吃分组表那一步同样标自动语义输入");
  assert.strictEqual(byName.get("layout").humanInput, false, "不吃这些输入的那一步不标");

  // 插件来源可以在运行中被换掉（换一份契约）：看板这份事实跟着契约走，不在自己这边留一份缓存。
  steps[2] = contractStep({ Id: 8, Name: "renamedLayout", Title: "Layout 清单", Inputs: ["分组表 Generated/_inputs/<Target>.layout-groups.json"] });
  const after = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(after.layoutStep, "renamedLayout", "换了契约之后按新的那一份算");
  fs.rmSync(fx.home, { recursive: true, force: true });
}

/*
 * 任务离开看板的三条路（移除这一条 / 清掉已结束 / 清空一个区域）都要把还没落地的暂存件一起收掉：
 * 暂存件按任务 id 落在安装根的 work/staged/ 下，看板上没有它，任务走了就没人认领。
 */
async function caseRemovalDropsStagedImage() {
  const fx = makeBoard();
  /* 暂存件在哪由 stage() 自己给（不在这里拼路径）：布局改了这条用例不用跟着改。 */
  const addWithImage = (target, ui) => {
    const id = fx.board.add({
      projectRoot: fx.project,
      ui: ui,
      items: [{ link: LINK, target: target, mode: "A" }]
    }).created[0];
    const staged = designImage.stage({ home: fx.home, taskId: id, data: png(1280, 1024).toString("base64") });
    assert.ok(fs.existsSync(staged.path), "先选好的图先暂存着");
    return { id: id, path: staged.path };
  };

  const removed = addWithImage("T1", "F1");
  await fx.board.remove(removed.id);
  assert.ok(!fs.existsSync(removed.path), "移除这一条：暂存件跟着走");

  const cleared = addWithImage("T2", "F2");
  fx.board.stop(cleared.id);
  assert.ok(fs.existsSync(cleared.path), "只是停下（任务还在看板上）就不动暂存件");
  fx.board.clear(["stopped"]);
  assert.ok(!fs.existsSync(cleared.path), "清掉已结束：暂存件跟着走");

  const area = addWithImage("T3", "F3");
  fx.board.clearArea(fx.project, "F3");
  assert.ok(!fs.existsSync(area.path), "清空一个区域：暂存件跟着走");

  fs.rmSync(fx.home, { recursive: true, force: true });
}

/*
 * 「能不能从断点继续」两支的边界：登记表里一条都没有＝没有断点（还没跑过，续＝从头再跑）；
 * 跑过几步且都 ok、但契约没跑满（跑到一半断了）＝断点是契约里还没跑过的那一步。
 */
async function caseResumeStepBoundary() {
  const fresh = makeBoard();
  const freshId = fresh.board.add({ projectRoot: fresh.project, items: [{ link: LINK, target: "T1", mode: "B" }] }).created[0];
  assert.strictEqual(
    fresh.board.snapshot().tasks.find((task) => task.id === freshId).resumeStep,
    "",
    "还没跑过：没有断点"
  );
  fs.rmSync(fresh.home, { recursive: true, force: true });

  const artifacts = {
    stepsOf: () => [{ id: 6, name: "discover", status: "ok", seconds: 1, note: "" }]
  };
  const half = makeBoard({ artifacts: artifacts });
  const halfId = half.board.add({ projectRoot: half.project, items: [{ link: LINK, target: "T1", mode: "B" }] }).created[0];
  half.board.start(halfId);
  await waitForTask(half.board, halfId, hasJob, "启动完成");
  assert.strictEqual(
    half.board.snapshot().tasks.find((task) => task.id === halfId).resumeStep,
    "图标台账",
    "跑过一步且都 ok、契约没跑满：断点是契约里还没跑过的那一步"
  );
  fs.rmSync(half.home, { recursive: true, force: true });
}

async function caseStopRemoveClearAndMerge() {
  const fx = makeBoard();
  const added = fx.board.add({ projectRoot: fx.project, items: [{ link: LINK, target: "T1", mode: "B" }, { link: LINK + "&b=1", target: "T2", mode: "B" }] });
  const [first, second] = added.created;
  assert.throws(() => fx.board.mergeOne(first), (error) => error.code === "NOT_READY", "没跑完的任务不能合并");
  assert.throws(() => fx.board.mergeOne("nope"), (error) => error.code === "NO_TASK");

  const stopped = fx.board.stop(first);
  assert.strictEqual(stopped.tasks.find((task) => task.id === first).state, "stopped");
  const removed = await fx.board.remove(second);
  assert.strictEqual(removed.tasks.some((task) => task.id === second), false);
  await assert.rejects(() => fx.board.remove("nope"), (error) => error.code === "NO_TASK");

  // 正在跑的任务不许直接移除：先停掉再移除。
  const third = fx.board.add({ projectRoot: fx.project, items: [{ link: LINK + "&c=1", target: "T3", mode: "B" }] }).created[0];
  fx.board.start(third);
  await waitForTask(fx.board, third, hasJob, "第三个任务跑起来");
  await assert.rejects(() => fx.board.remove(third), (error) => error.code === "BUSY_TASK");
  fx.board.stop(third);
  const afterStop = await fx.board.remove(third);
  assert.strictEqual(afterStop.tasks.some((task) => task.id === third), false);

  const cleared = fx.board.clear(["stopped"]);
  assert.strictEqual(cleared.tasks.length, 0);
  fs.rmSync(fx.home, { recursive: true, force: true });
}

async function caseProgressStepsAndTargetAdoption() {
  const artifacts = {
    stepsOf: () => [
      { id: 6, name: "discover", status: "ok", seconds: 1, note: "候选 3" },
      { id: 7, name: "ledger", status: "skipped", seconds: 0, note: "" }
    ]
  };
  const fx = makeBoard({ artifacts: artifacts });
  const added = fx.board.add({ projectRoot: fx.project, ui: "F3", items: [{ link: LINK, mode: "B" }] });
  const id = added.created[0];
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, '启动完成');

  // 没写 Target 时，跑起来之后从运行登记表的目录名把真实 Target 认回来
  write(path.join(task.workDir, "Generated", "runs", "F3Align", "run.json"), '{ "outputs": [] }\n');
  fx.runs.seed(task.jobId, { id: task.jobId, state: "done", request: {}, runs: [] }, task.workDir);
  await sleep(TICK + 300);
  const after = fx.board.snapshot().tasks.find((item) => item.id === id);
  assert.strictEqual(after.request.target, "F3Align", "Target 从运行目录认领");
  assert.deepStrictEqual(after.steps.map((step) => step.name), ["discover", "ledger"]);
  assert.strictEqual(after.steps[0].humanInput, false);
  assert.strictEqual(after.steps[1].humanInput, true, "吃人/AI 输入的步骤按契约 Inputs 标出来");
  assert.ok(after.progress, "有运行登记表就要给进度");
  assert.strictEqual(after.progress.done, 1, "只把 ok 计入完成（skipped 不算跑过这一步）");
  assert.strictEqual(after.progress.total, 2, "分母是契约里的步骤数");
  // 「从断点继续」的判据也在这里给：登记表里一步都没跑完时，断点就是下一步（界面读它、写在按钮上，不自己猜）。
  assert.strictEqual(after.resumeStep, "图标台账", "断点由登记表给，给的是那一步在界面上的名字");
  fs.rmSync(fx.home, { recursive: true, force: true });
}

async function main() {
  const cases = [
    ["重启后把不可能还在跑的任务标成已停止", caseLoadMarksDeadTasksStopped],
    ["加任务：校验与参数落地", caseAddValidationAndFields],
    ["启动：工作目录与并发队列", caseStartUsesWorkDirAndKeepsQueue],
    ["deferStart 等暂存完成再启动", caseDeferredTaskWaitsForExplicitStart],
    ["启动全部不越过暂存门禁", caseStartAllKeepsDeferredTasks],
    ["tick 同步：跑完自动合并", caseTickSyncsReadyAndMerges],
    ["语义停点与自动补输入", caseSemanticStopAndAutoFill],
    ["补输入到上限与真失败", caseAutoFillLimitAndRealFailure],
    ["输入读不出来（位图坏了）：整句写回、不占额度", caseAutoFillBlockedByInput],
    ["补输入抛出来的错误也带修法", caseAutoFillThrownErrorKeepsHint],
    ["先选的页面 PNG：尺寸不符写在行上、条件解除自清", caseStagedImageNotice],
    ["A 路线没有页面 PNG 时停在待确认，不自动合并", casePipelineARequiresImageBeforeReady],
    ["从布局续跑完成也要按当前页面 PNG 检查分组", caseLayoutRerunsAfterProgressWhenImageNeedsGroups],
    ["B 的真实失败不被布局停点改判", caseBRealFailureIsNotReclassifiedByLayout],
    ["坏图先停页面 PNG 核对点，不抢跑布局", caseBadImageStopsBeforeLayoutRerun],
    ["页面身份不合规时停在等图点，不从轮询逸出", caseUnsafeImageIdentityStopsInsteadOfThrowing],
    ["合并期间不因换图重启布局", caseMergingDoesNotRestartLayout],
    ["任务离开看板（移除 / 清理 / 清空区域）：暂存件跟着走", caseRemovalDropsStagedImage],
    ["「哪一步吃布局输入」按契约的 Inputs 判，不认步骤名", caseLayoutStepComesFromContract],
    ["「能不能续、续哪一步」的两支边界（没跑过 / 跑到一半）", caseResumeStepBoundary],
    ["停止 / 移除 / 清理 / 合并前置校验", caseStopRemoveClearAndMerge],
    ["进度、步骤视图与 Target 认领", caseProgressStepsAndTargetAdoption]
  ];
  for (const [name, run] of cases) {
    await run();
    console.log("  ok  " + name);
  }
  console.log("board-flow.test.js 全部通过");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
