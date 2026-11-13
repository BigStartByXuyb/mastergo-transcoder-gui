#!/usr/bin/env node
"use strict";

/*
 * 待确认查询映射：任务、运行与手填来源只产出同一种 pending.inspect 入参。
 * 详情面板与待确认队列共用这些函数，停点字段增删时不会各改一份。
 * 跑法：node tests/pending-query.test.js
 */

const assert = require("assert");

const { queryOfTask, queryOfRun, queryOfManual } = require("../lib/pending.js");

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

assert.deepStrictEqual(queryOfRun({
  projectRoot: "D:/work/run-1",
  target: "DemoPage",
  mode: "AB",
  state: "failed",
  layoutStep: "layoutManifest",
  failedStep: "layoutManifest",
  failedMessage: "[LAYOUT_GROUPS_REJECTED] 拒收",
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
}, "直跑运行映射");

assert.deepStrictEqual(queryOfManual({
  projectRoot: "D:/manual",
  target: "ManualPage",
  mode: "B"
}), {
  projectRoot: "D:/manual",
  target: "ManualPage",
  mode: "B",
  state: "",
  layoutStep: "",
  failedStep: "",
  failedMessage: "",
  imageStop: false
}, "手填来源没有停点事实，不伪造");

console.log("pending-query.test.js 全部通过");
