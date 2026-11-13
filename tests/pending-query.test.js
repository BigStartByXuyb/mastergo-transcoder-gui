#!/usr/bin/env node
"use strict";

/*
 * 待确认查询映射：任务、运行与手填来源只产出同一种 pending.inspect 入参。
 * 详情面板与待确认队列共用这些函数，停点字段增删时不会各改一份。
 * 跑法：node tests/pending-query.test.js
 */

const assert = require("assert");

const {
  queryOfTask,
  queryOfRun,
  queryOfManual,
  sourceOfRun,
  taskAtProjectRoot
} = require("../lib/pending.js");

assert.deepStrictEqual(queryOfTask({
  workDir: "D:/work/task-1",
  state: "waiting",
  imageStop: false,
  layoutStep: "layoutManifest",
  request: { target: "DemoPage", mode: "A" },
  failure: { stepName: "layoutManifest", message: "[LAYOUT_GROUPS_MISSING] 缺表" }
}), {
  projectRoot: "D:/work/task-1",
  target: "DemoPage",
  mode: "A",
  state: "waiting",
  layoutStep: "layoutManifest",
  failedStep: "layoutManifest",
  failedMessage: "[LAYOUT_GROUPS_MISSING] 缺表",
  imageStop: false
}, "看板任务映射");

assert.deepStrictEqual(queryOfTask({
  workDir: "D:/work/task-1",
  state: "running",
  request: { target: "DemoPage", mode: "A" }
}, {
  state: "failed",
  layoutStep: "layoutManifest",
  failedStep: "layoutManifest",
  failedMessage: "推导失败",
  imageStop: false
}), {
  projectRoot: "D:/work/task-1",
  target: "DemoPage",
  mode: "A",
  state: "failed",
  layoutStep: "layoutManifest",
  failedStep: "layoutManifest",
  failedMessage: "推导失败",
  imageStop: false
}, "同一次失败可以直接用当前停点覆盖任务尚未刷新的状态");

const run = {
  projectRoot: "D:/work/run-1",
  target: "DemoPage",
  mode: "AB",
  state: "failed",
  layoutStep: "layoutManifest",
  failedStep: "layoutManifest",
  failedMessage: "[LAYOUT_GROUPS_REJECTED] 拒收",
  imageStop: true
};
assert.deepStrictEqual(queryOfRun(run), {
  projectRoot: "D:/work/run-1",
  target: "DemoPage",
  mode: "AB",
  state: "failed",
  layoutStep: "layoutManifest",
  failedStep: "layoutManifest",
  failedMessage: "[LAYOUT_GROUPS_REJECTED] 拒收",
  imageStop: false
}, "运行摘要不承载等图事实");

assert.deepStrictEqual(queryOfRun(run, {
  workDir: "d:/WORK/RUN-1",
  imageStop: true
}), {
  projectRoot: "D:/work/run-1",
  target: "DemoPage",
  mode: "AB",
  state: "failed",
  layoutStep: "layoutManifest",
  failedStep: "layoutManifest",
  failedMessage: "[LAYOUT_GROUPS_REJECTED] 拒收",
  imageStop: true
}, "运行来源的等图事实来自同工作目录的看板任务");

const relatedTask = { id: "task-1", workDir: "d:/WORK/RUN-1", imageStop: true };
assert.strictEqual(taskAtProjectRoot([{ id: "other", workDir: "D:/work/run-2" }, relatedTask], run.projectRoot), relatedTask,
  "运行按整段工作目录匹配任务，大小写不敏感");
assert.deepStrictEqual(sourceOfRun(run, relatedTask), {
  task: null,
  run: run,
  query: {
    projectRoot: "D:/work/run-1",
    target: "DemoPage",
    mode: "AB",
    state: "failed",
    layoutStep: "layoutManifest",
    failedStep: "layoutManifest",
    failedMessage: "[LAYOUT_GROUPS_REJECTED] 拒收",
    imageStop: true
  }
}, "运行来源仍绑定运行，不把关联任务变成写回来源");

assert.deepStrictEqual(queryOfManual({
  projectRoot: "D:/manual",
  target: "ManualPage",
  mode: "B",
  state: "failed",
  layoutStep: "layoutManifest",
  failedStep: "layoutManifest",
  failedMessage: "[LAYOUT_GROUPS_REJECTED] 伪造",
  imageStop: true
}), {
  projectRoot: "D:/manual",
  target: "ManualPage",
  mode: "B",
  state: "",
  layoutStep: "",
  failedStep: "",
  failedMessage: "",
  imageStop: false
}, "手填来源只保留页面身份；请求自报的停点事实一律丢弃");

console.log("pending-query.test.js 全部通过");
