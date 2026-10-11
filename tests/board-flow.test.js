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
        return options.pending || { icons: { available: true, needsNaming: true, needsRepair: false, mustName: [1, 2] }, translations: { available: false } };
      }
    },
    autoFill: options.autoFill === undefined
      ? null
      : {
          fill: async () => {
            autoFillCalls.push(true);
            return options.autoFill;
          }
        },
    layout: { register: () => ({ ok: true }) },
    artifacts: options.artifacts || null,
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
  write(path.join(home, "board.json"), JSON.stringify([
    { id: "t1", state: "running", request: { projectRoot: "D:/p", link: LINK, target: "T" }, workDir: "D:/w" },
    { id: "t2", state: "merged", request: { projectRoot: "D:/p", link: LINK, target: "T" }, workDir: "D:/w" }
  ]));
  const runs = makeRuns();
  const board = createBoard({ runs: runs.api, pending: null, home: home });
  const states = board.snapshot().tasks.map((task) => task.state);
  assert.deepStrictEqual(states, ["stopped", "merged"], "重启后不可能还在跑：running 变 stopped，其它状态保留");
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
      failure: { stepId: 7, stepName: "ledger", message: "缺少命名表", resume: "", detail: "", contract: { Title: "图标台账" } },
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
    artifacts: null,
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
 * 新建任务时先选的设计稿位图：跑到「取数 + 固化快照」之后核对尺寸 —— 对不上就在任务行上写一句
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
 * 「哪一步吃布局输入」按契约的 Inputs 判，不看步骤名：契约里叫 layout 的那一步若不吃分组表，
 * 界面就不会把设计稿位图与布局确认挂上去（另有一个 decoy 故意叫这个名字）。
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
    read: () => ({
      available: true,
      steps: [
        { id: 3, name: "layout", status: "ok", seconds: 1, note: "" },
        { id: 7, name: "ledger", status: "ok", seconds: 1, note: "" },
        { id: 8, name: "layoutManifest", status: "ok", seconds: 1, note: "" }
      ]
    })
  };
  const fx = makeBoard({ steps: steps, artifacts: artifacts });
  const added = fx.board.add({ projectRoot: fx.project, items: [{ link: LINK, target: "T1", mode: "A" }] });
  const id = added.created[0];
  fx.board.start(id);
  const task = await waitForTask(fx.board, id, hasJob, "启动完成");
  const byName = new Map(task.steps.map((step) => [step.name, step]));
  assert.strictEqual(task.layoutStep, "layoutManifest", "吃分组表的那一步就是布局那一步（叫 layout 的那一步不算）");
  assert.strictEqual(byName.get("ledger").humanInput, true, "吃命名表那一步仍标「人/AI 语义输入」");
  assert.strictEqual(byName.get("layoutManifest").humanInput, true, "吃分组表那一步同样是人/AI 语义输入");
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
    read: () => ({
      available: true,
      steps: [
        { id: 6, name: "discover", status: "ok", seconds: 1, note: "候选 3" },
        { id: 7, name: "ledger", status: "skipped", seconds: 0, note: "" }
      ]
    })
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
  // 「从断点继续」的判据也在这里给：登记表里一步都没跑完时，断点就是下一步（界面读它，不自己猜）。
  assert.deepStrictEqual(after.resume, { finished: false, step: "ledger" }, "断点由登记表给：下一步是 ledger");
  fs.rmSync(fx.home, { recursive: true, force: true });
}

async function main() {
  const cases = [
    ["重启后把不可能还在跑的任务标成已停止", caseLoadMarksDeadTasksStopped],
    ["加任务：校验与参数落地", caseAddValidationAndFields],
    ["启动：工作目录与并发队列", caseStartUsesWorkDirAndKeepsQueue],
    ["tick 同步：跑完自动合并", caseTickSyncsReadyAndMerges],
    ["语义停点与自动补输入", caseSemanticStopAndAutoFill],
    ["补输入到上限与真失败", caseAutoFillLimitAndRealFailure],
    ["先选的设计稿位图：尺寸不符写在行上、条件解除自清", caseStagedImageNotice],
    ["任务离开看板（移除 / 清理 / 清空区域）：暂存件跟着走", caseRemovalDropsStagedImage],
    ["「哪一步吃布局输入」按契约的 Inputs 判，不认步骤名", caseLayoutStepComesFromContract],
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
