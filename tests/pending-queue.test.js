#!/usr/bin/env node
"use strict";

/*
 * 待确认队列：把「还缺语义输入的页面」列出来，并按工程目录 + 页面去重。
 * 这里只验列表这条线自己的事 —— 谁有资格进列表（条数不为 0）、去重、来源与状态名怎么给。
 * 每条的条数由 lib/pending.js 一处算（本用例用桩给数），状态名由 lib/board.js 的 stateLabelOf 一处映射。
 * 跑法：node tests/pending-queue.test.js
 */

const assert = require("assert");
const os = require("os");
const path = require("path");

const { createPendingQueue } = require("../lib/pending-queue.js");

const HOME = path.join(os.tmpdir(), "gui-pending-queue");
const PROJECT = path.join(HOME, "proj-a");
const WORK = path.join(HOME, "work", "task-1");

/* 桩：插件产物的待办条数由用例给（真值源是 lib/pending.js，这里不重算）。 */
function makeQueue(options) {
  return createPendingQueue({
    runs: { list: () => options.runs || [] },
    board: {
      workRoot: path.join(HOME, "work"),
      snapshot: () => ({ tasks: options.tasks || [] })
    },
    pending: { inspect: () => options.pending || { icons: { waiting: 0 }, translations: { waiting: 0 }, layout: { waiting: 0 } } }
  });
}

function caseEntryShape() {
  const queue = makeQueue({
    tasks: [{ id: "task-1", state: "waiting", jobId: "job-1", workDir: WORK, request: { target: "DemoPage" } }],
    pending: { icons: { waiting: 2 }, translations: { waiting: 1 }, layout: { waiting: 0 } }
  });
  const items = queue.snapshot().items;

  assert.strictEqual(items.length, 1);
  assert.deepStrictEqual(items[0].counts, { icons: 2, translations: 1, layout: 0 }, "三节条数各取一处算出来的数");
  assert.strictEqual(items[0].total, 3, "合计数是三者之和");
  assert.strictEqual(items[0].source, "board");
  assert.strictEqual(items[0].taskId, "task-1");
  assert.strictEqual(items[0].runState, "waiting");
  assert.strictEqual(items[0].stateLabel, "待确认", "状态名随条目给出来，界面不自己抄文案");
}

/*
 * 前缀判据按「整段路径」比：工作目录是 `…\work` 时，`…\work2\…` 上的运行不算看板来源
 *（只差一个字符的目录名在 Windows 上很常见）；大小写不敏感那一半也照同一条判据。
 */
function caseWorkRootPrefix() {
  const workRoot = path.join(HOME, "work");
  const queue = makeQueue({
    runs: [{ id: "job-9", projectRoot: path.join(HOME, "work2", "x"), target: "DemoPage", state: "running" }],
    pending: { icons: { waiting: 1 }, translations: { waiting: 0 }, layout: { waiting: 0 } }
  });
  assert.strictEqual(queue.snapshot().items[0].source, "pipeline", "只差一个字符的目录不算看板来源");

  const upper = makeQueue({
    runs: [{ id: "job-10", projectRoot: workRoot.toUpperCase(), target: "DemoPage", state: "running" }],
    pending: { icons: { waiting: 1 }, translations: { waiting: 0 }, layout: { waiting: 0 } }
  });
  assert.strictEqual(upper.snapshot().items[0].source, "board", "大小写不同还是同一个工作目录（Windows）");
}

// 一条都不需要填的页面不进列表。
function caseEmptyIsSkipped() {
  const queue = makeQueue({
    tasks: [{ id: "task-1", state: "waiting", jobId: "job-1", workDir: WORK, request: { target: "DemoPage" } }],
    pending: { icons: { waiting: 0 }, translations: { waiting: 0 }, layout: { waiting: 0 } }
  });
  assert.deepStrictEqual(queue.snapshot().items, [], "没有要填的就不列出来");
}

/*
 * 同一个页面被两条线各跑过一次（看板任务的工作目录 + 流水线直跑的运行）：按「工程目录 + 页面」去重，
 * 看板那条先算，后来的同名条目丢掉 —— 不然人会在列表里看到同一页两次。
 */
function caseDedupeByProjectAndTarget() {
  const queue = makeQueue({
    tasks: [{ id: "task-1", state: "waiting", jobId: "job-1", workDir: WORK, request: { target: "DemoPage" } }],
    runs: [
      { id: "job-2", projectRoot: WORK, target: "DemoPage", state: "running" },
      { id: "job-3", projectRoot: PROJECT, target: "OtherPage", state: "done" }
    ],
    pending: { icons: { waiting: 1 }, translations: { waiting: 0 }, layout: { waiting: 0 } }
  });
  const items = queue.snapshot().items;

  assert.deepStrictEqual(items.map((item) => item.target), ["DemoPage", "OtherPage"]);
  assert.strictEqual(items[0].taskId, "task-1", "同一个工作目录的那条按看板任务算");
  assert.strictEqual(items[1].source, "pipeline", "主工程上的运行没有对应任务，算流水线来源");
  assert.strictEqual(items[1].stateLabel, "已跑完", "运行自己的状态（done）也在同一份文案里");
}

try {
  const cases = [
    ["条目形状：条数、来源、状态名", caseEntryShape],
    ["看板来源按整段路径判（work 不吃 work2、大小写不敏感）", caseWorkRootPrefix],
    ["一条都不需要填的不进列表", caseEmptyIsSkipped],
    ["同一页只列一条", caseDedupeByProjectAndTarget]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("pending-queue.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
