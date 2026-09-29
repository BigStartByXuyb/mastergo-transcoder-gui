#!/usr/bin/env node
"use strict";

// 看板任务的登记与启动：加任务返回新 id、参数（含 stopAfter/overwrite）落到任务上、
// 启动时在工作目录里调执行引擎。跑法：node tests/board.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBoard } = require("../lib/board.js");

const LINK = "https://mastergo.com/goto/abc?file=204689197363903&layer_id=1872:60904";

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

// 假执行引擎：只记下收到的请求；状态一律"在跑"，让任务停在工作目录已建好的那一步。
function stubRuns() {
  const started = [];
  return {
    started: started,
    start: function (request) {
      started.push(request);
      return { id: "job-" + started.length };
    },
    status: function () {
      return {
        id: "job-1",
        state: "running",
        request: {},
        plan: [],
        runs: [{
          mode: "mtslg-iocontrol",
          label: "B",
          state: "running",
          startedAt: "",
          endedAt: "",
          exitCode: null,
          currentStep: 1,
          steps: {},
          failure: null,
          tail: [],
          command: ""
        }],
        log: ""
      };
    },
    contract: function () {
      return [];
    },
    latestFor: function () {
      return null;
    }
  };
}

function taskOf(board, id) {
  return board.snapshot().tasks.find(function (item) { return item.id === id; }) || null;
}

async function waitFor(check, label) {
  for (let index = 0; index < 100; index += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("等超时：" + label);
}

// 加任务：返回新任务 id，参数原样落到任务上。
function caseAdd(fx) {
  const board = fx.board();
  const result = board.add({
    projectRoot: fx.project,
    ui: "F3",
    mode: "A",
    autoMerge: false,
    overwrite: true,
    stopAfter: "discover",
    items: [{ link: LINK, target: "Align", mode: "A" }]
  });
  assert.strictEqual(result.created.length, 1, "必须返回新任务的 id");
  const task = result.board.tasks.find((item) => item.id === result.created[0]);
  assert.ok(task, "新任务必须在快照里");
  assert.strictEqual(task.state, "queued");
  assert.strictEqual(task.request.target, "Align");
  assert.strictEqual(task.request.mode, "A");
  assert.strictEqual(task.request.ui, "F3");
  assert.strictEqual(task.request.stopAfter, "discover", "停点要落到任务上");
  assert.strictEqual(task.request.overwrite, true);
  assert.strictEqual(task.autoMerge, false);
  assert.strictEqual(task.request.fileId, "204689197363903", "链接解析出的 fileId");
  assert.strictEqual(task.request.layerId, "1872:60904");

  const again = board.add({ projectRoot: fx.project, stopAfter: "bundle", items: [{ link: LINK, target: "B2" }] });
  const second = again.board.tasks.find((item) => item.id === again.created[0]);
  assert.strictEqual(second.request.stopAfter, "bundle", "任务级停点也要落到任务上");
  assert.strictEqual(second.request.mode, "B", "没给路线时用默认 B");

  assert.throws(
    function () { board.add({ projectRoot: "", items: [{ link: LINK }] }); },
    /工程目录/,
    "缺工程目录要直接拒绝"
  );
  assert.throws(
    function () { board.add({ projectRoot: fx.project, items: [{ link: "https://mastergo.com/goto/x" }] }); },
    /file/,
    "链接里没有 file/layer_id 要直接拒绝"
  );
}

// 启动：在任务自己的工作目录里调执行引擎，参数带上停点、覆盖与来源。
async function caseStart(fx) {
  const board = fx.board();
  const added = board.add({
    projectRoot: fx.project,
    ui: "F3",
    overwrite: true,
    stopAfter: "discover",
    items: [{ link: LINK, target: "Align", mode: "B" }]
  });
  const id = added.created[0];
  board.start(id);
  await waitFor(function () {
    const task = taskOf(board, id);
    return task && task.state === "running";
  }, "任务进入运行中");

  const task = taskOf(board, id);
  assert.ok(task.workDir && fs.existsSync(task.workDir), "任务要有自己的工作目录");
  assert.notStrictEqual(task.workDir, fx.project, "流水线跑在工作目录里，不动主工程");
  assert.ok(fs.existsSync(path.join(task.workDir, "demo.txt")), "工作目录是主工程的副本");

  const request = fx.runs.started[0];
  assert.strictEqual(request.projectRoot, task.workDir, "执行引擎的 -ProjectRoot 是工作目录");
  assert.strictEqual(request.origin, "board");
  assert.strictEqual(request.stopAfter, "discover", "停点要传到执行引擎");
  assert.strictEqual(request.overwrite, true);
  assert.strictEqual(request.ui, "F3");
  assert.strictEqual(request.fileId, "204689197363903");
  assert.strictEqual(request.layerId, "1872:60904");
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-board-test-"));
  const project = path.join(root, "project");
  write(path.join(project, "docs", "page-registry.json"), "{ \"pages\": [] }\n");
  write(path.join(project, "demo.txt"), "demo\n");

  const cases = [
    ["加任务与参数", caseAdd],
    ["启动走工作目录", caseStart]
  ];
  try {
    for (const [name, run] of cases) {
      const home = path.join(root, "home-" + name);
      fs.mkdirSync(home, { recursive: true });
      const runs = stubRuns();
      const fx = {
        root: root,
        project: project,
        runs: runs,
        board: function () {
          return createBoard({ runs: runs, pending: null, home: home });
        }
      };
      await run(fx);
      console.log("  ok  " + name);
    }
    console.log("board.test.js 全部通过");
  }
  finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
