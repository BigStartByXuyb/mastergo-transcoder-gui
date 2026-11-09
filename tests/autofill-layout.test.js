#!/usr/bin/env node
"use strict";

/*
 * 布局自动补全：模型给几组就写几组；一组都没给也算一种结论（空表＝本页没有要声明的分组），
 * 照写并按机械判据往下 —— 与人工确认可以写空表同一口径。
 * 这一步的输入（本层可引用条目 + 本页设计稿位图）取自 lib/layout-groups.js 的 candidatesInput（真实现、真盘）：
 * 有图就把位图的 data URL 交给模型，图读不出来就照 blocked 交回给人（不写盘、不当作模型没给结果）。
 * 跑法：node tests/autofill-layout.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createAutoFill } = require("../lib/autofill.js");
const { png } = require("./image-fixtures.js");

/* 这一层的可引用条目（插件第 8 步落的那份清单里就是这几条：ref / 类型 / 文本，没有坐标）。 */
const ENTRIES = [
  { ref: "1:9", controlType: "IconButton", text: "确定" },
  { ref: "1:10", controlType: "IconButton", text: "取消" }
];

/* 一份最小工程：条目清单（candidatesInput 从盘上读它）+ 那一页的设计稿位图（不给就是没图）。 */
function sandbox(bytes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-autofill-layout-"));
  const candidates = path.join(root, "Generated", "_inputs", "T1.layout-group-candidates.json");
  fs.mkdirSync(path.dirname(candidates), { recursive: true });
  fs.writeFileSync(candidates, JSON.stringify({
    schemaVersion: "mw-wpf-layout-group-candidates/1",
    pageTarget: "T1",
    source: { dslPath: "", dslSha256: "" },
    entries: ENTRIES
  }), "utf8");
  if (bytes) {
    const file = path.join(root, "Generated", "_inputs", "T1.design.png");
    fs.writeFileSync(file, bytes);
  }
  return root;
}

/* 三个协作者都用桩：这里只验「给模型的是什么、写出去的 payload 是什么」。 */
function harness(options) {
  const committed = [];
  const inputs = [];
  const otherCalls = [];
  const autoFill = createAutoFill({
    ai: {
      suggestLayoutGroups: async (input) => {
        inputs.push(input);
        return { groups: options.groups };
      },
      suggestIconNames: async () => {
        otherCalls.push("icons");
        return { items: [] };
      }
    },
    pending: {
      inspect: () => options.pending || ({
        icons: {},
        translations: {},
        layout: { needsGroups: true, waiting: 1 }
      })
    },
    confirm: {
      commit: (payload) => {
        committed.push(payload);
        return { job: null };
      }
    },
    settings: { read: () => ({ automation: options.automation }) }
  });
  return { autoFill: autoFill, committed: committed, inputs: inputs, otherCalls: otherCalls };
}

async function caseGroupsWritten() {
  const projectRoot = sandbox(png(1280, 1024));
  const fx = harness({ automation: "assist", groups: [{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }] });
  const result = await fx.autoFill.fill({ projectRoot: projectRoot, target: "T1", runId: "job-1", request: { mode: "A" } });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(fx.committed[0].groups, [{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }]);
  assert.strictEqual(result.filled[0], "布局分组 1 组");
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

async function caseEmptyIsAConclusion() {
  const projectRoot = sandbox(png(1280, 1024));
  const fx = harness({ automation: "assist", groups: [] });
  const result = await fx.autoFill.fill({ projectRoot: projectRoot, target: "T1", runId: "job-1", request: { mode: "A" } });
  assert.strictEqual(result.ok, true, "一组都没给也要往下，不能当成「模型没给出可用结果」");
  assert.deepStrictEqual(fx.committed[0].groups, [], "写出空表：本页没有要声明的分组");
  assert.match(result.filled[0], /空表/);
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

async function caseAssistDoesNotAutoWriteOthers() {
  const projectRoot = sandbox(png(1280, 1024));
  const icons = {
    needsNaming: true,
    mustName: [{ index: 1 }],
    naming: [],
    duplicates: [],
    needsRepair: false
  };
  const fx = harness({
    automation: "assist",
    groups: [{ id: "Row", kind: "row", members: ["1:9", "1:10"] }],
    pending: { icons, translations: {}, layout: { needsGroups: true, waiting: 1 } }
  });
  const result = await fx.autoFill.fill({ projectRoot, target: "T1", request: { mode: "A" } });
  assert.strictEqual(result.ok, true, "辅助层级仍自动补 A 的布局分组");
  assert.deepStrictEqual(fx.otherCalls, [], "辅助层级不得自动写图标、译文或术语");
  assert.strictEqual(fx.committed[0].naming, undefined);
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

async function caseAutoWritesOthers() {
  const projectRoot = sandbox(png(1280, 1024));
  const icons = {
    needsNaming: true,
    mustName: [{ index: 1 }],
    naming: [],
    duplicates: [],
    needsRepair: false
  };
  const fx = harness({
    automation: "auto",
    groups: [{ id: "Row", kind: "row", members: ["1:9", "1:10"] }],
    pending: { icons, translations: {}, layout: { needsGroups: true, waiting: 1 } }
  });
  await fx.autoFill.fill({ projectRoot, target: "T1", request: { mode: "A" } });
  assert.deepStrictEqual(fx.otherCalls, ["icons"], "全自动层级才自动写图标、译文或术语");
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

/*
 * 条目清单不在（这一步还没跑过）：这是这一步的输入读不出来，与图坏了同一类 ——
 * 整句交回给人（含怎么做），不写盘、不当「模型没给出结果」。
 */
async function caseNoCandidatesBlocks() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gui-autofill-layout-"));
  const fx = harness({ automation: "assist", groups: [] });
  const result = await fx.autoFill.fill({ projectRoot: projectRoot, target: "T1", runId: "job-1", request: { mode: "A" } });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.blocked, true, "标成输入问题：调用方据此不把它算进自动补输入的额度");
  assert.match(result.reason, /还没有这一步的条目清单/, "说清是哪一件事");
  assert.match(result.reason, /：跑一次/, "整句要带上怎么做");
  assert.deepStrictEqual(fx.committed, [], "输入都读不出来就不写盘");
  assert.deepStrictEqual(fx.inputs, [], "没到模型那一步");
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

async function caseAutomationOff() {
  const projectRoot = sandbox(png(1280, 1024));
  const fx = harness({ automation: "off", groups: [], projectRoot });
  const result = await fx.autoFill.fill({ projectRoot, target: "T1", runId: "job-1", request: { mode: "A" } });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /自动化已关闭/);
  assert.strictEqual(fx.inputs.length, 0, "关（不叫模型）时 A 路线也不得绕过设置");
  assert.deepStrictEqual(fx.committed, []);
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

/* 有图就得让模型真看到图：位图按 data URL 一起给，本层条目照旧。 */
async function caseBitmapGoesToModel() {
  const projectRoot = sandbox(png(1280, 1024));
  const fx = harness({ automation: "assist", groups: [], projectRoot: projectRoot });
  await fx.autoFill.fill({ projectRoot: projectRoot, target: "T1", runId: "job-1", request: { mode: "A" } });
  assert.strictEqual(fx.inputs.length, 1, "这一步要问模型");
  assert.match(fx.inputs[0].image, /^data:image\/png;base64,/, "本页那张位图按 data URL 一起给模型");
  assert.deepStrictEqual(fx.inputs[0].entries, ENTRIES, "这一层的条目原样给过去");
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

/*
 * 没有位图：这一步不问模型（它是对着图判分组，没图时分组由机械判据决定）——
 * 判据由 lib/layout-groups.js 的 candidatesInput 在生产路径上执行；待确认读数只给 needsGroups。
 */
async function caseNoBitmap() {
  const projectRoot = sandbox();
  const fx = harness({ automation: "assist", groups: [], projectRoot: projectRoot });
  const result = await fx.autoFill.fill({ projectRoot: projectRoot, target: "T1", runId: "job-1", request: { mode: "A" } });
  assert.deepStrictEqual(fx.inputs, [], "没有图就不问模型");
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /没有传图/, "按「哪一条没满足」交回给人");
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

/*
 * 图坏了：这是这一步的输入读不出来，不是模型给不出结果 ——
 * 整句（原因 + 怎么做）交回给人，不写盘、也不算「模型没有给出可用结果」。
 */
async function caseBrokenBitmapBlocks() {
  const projectRoot = sandbox(Buffer.from("这不是一张位图", "utf8"));
  const fx = harness({ automation: "assist", groups: [], projectRoot: projectRoot });
  const result = await fx.autoFill.fill({ projectRoot: projectRoot, target: "T1", runId: "job-1", request: { mode: "A" } });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.blocked, true, "标成输入问题：调用方据此不把它算进自动补输入的额度");
  assert.match(result.reason, /读不出格式/, "说清是哪一件事");
  assert.match(result.reason, /：重新导出/, "整句要带上怎么做（单串形态由 lib/errors.js 的 failureSentence 拼）");
  assert.deepStrictEqual(fx.committed, [], "输入都读不出来就不写盘");
  assert.deepStrictEqual(fx.inputs, [], "没到模型那一步");
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

const CASES = [
  ["模型给出分组就照写", caseGroupsWritten],
  ["模型一组没给：空表也是结论", caseEmptyIsAConclusion],
  ["辅助层级只自动补 A 的布局分组", caseAssistDoesNotAutoWriteOthers],
  ["全自动层级才自动补图标等语义输入", caseAutoWritesOthers],
  ["条目清单不在：整句交回给人、不写盘", caseNoCandidatesBlocks],
  ["全局自动化关闭时布局分组也不叫模型", caseAutomationOff],
  ["有图就把位图一起给模型", caseBitmapGoesToModel],
  ["没有位图：不问模型，按哪一条没满足交回", caseNoBitmap],
  ["图坏了：整句交回给人、不写盘", caseBrokenBitmapBlocks]
];

(async function main() {
  for (const [name, run] of CASES) {
    await run();
    console.log("  ok  " + name);
  }
  console.log("autofill-layout.test.js 全部通过");
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
