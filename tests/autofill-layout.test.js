#!/usr/bin/env node
"use strict";

/*
 * 布局自动通过：模型给几组就写几组；一组都没给也算一种结论（空表＝本页没有要声明的分组），
 * 照写并按机械判据往下 —— 与人工确认可以写空表同一口径。
 * 这一步的输入（控件清单 + 本页设计稿位图）取自 lib/layout-groups.js 的 candidatesInput（真实现、真盘）：
 * 有图就把位图的 data URL 交给模型，图读不出来就照 blocked 交回给人（不写盘、不当作模型没给结果）。
 * 跑法：node tests/autofill-layout.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createAutoFill } = require("../lib/autofill.js");
const { png } = require("./image-fixtures.js");

const CONTROLS = [
  { ref: "1:9", controlType: "IconButton", text: "确定", absX: 0, absY: 0, w: 10, h: 10 },
  { ref: "1:10", controlType: "IconButton", text: "取消", absX: 40, absY: 0, w: 10, h: 10 }
];

/* 一份最小工程：只有那一页的设计稿位图（不给就是没图）。 */
function sandbox(bytes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-autofill-layout-"));
  if (bytes) {
    const file = path.join(root, "Generated", "_inputs", "T1.design.png");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  return root;
}

/* 三个协作者都用桩：这里只验「给模型的是什么、写出去的 payload 是什么」。 */
function harness(options) {
  const committed = [];
  const inputs = [];
  const autoFill = createAutoFill({
    ai: {
      suggestLayoutGroups: async (input) => {
        inputs.push(input);
        return { groups: options.groups };
      }
    },
    pending: {
      inspect: () => ({
        icons: {},
        translations: {},
        layout: { needsGroups: true, waiting: 1, controls: CONTROLS }
      })
    },
    confirm: {
      commit: (payload) => {
        committed.push(payload);
        return { job: null };
      }
    },
    settings: { read: () => ({ automation: options.automation, layoutAutoPass: options.layoutAutoPass }) }
  });
  return { autoFill: autoFill, committed: committed, inputs: inputs, projectRoot: options.projectRoot };
}

async function caseGroupsWritten() {
  const fx = harness({ automation: "assist", layoutAutoPass: true, groups: [{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }] });
  const result = await fx.autoFill.fill({ projectRoot: "D:/work", target: "T1", runId: "job-1" });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(fx.committed[0].groups, [{ id: "RightTools", kind: "column", members: ["1:9", "1:10"] }]);
  assert.strictEqual(result.filled[0], "布局分组 1 组");
}

async function caseEmptyIsAConclusion() {
  const fx = harness({ automation: "assist", layoutAutoPass: true, groups: [] });
  const result = await fx.autoFill.fill({ projectRoot: "D:/work", target: "T1", runId: "job-1" });
  assert.strictEqual(result.ok, true, "一组都没给也要往下，不能当成「模型没给出可用结果」");
  assert.deepStrictEqual(fx.committed[0].groups, [], "写出空表：本页没有要声明的分组");
  assert.match(result.filled[0], /空表/);
}

async function caseAutomationOff() {
  const fx = harness({ automation: "off", layoutAutoPass: true, groups: [{ id: "g", kind: "row", members: ["1:9", "1:10"] }] });
  const result = await fx.autoFill.fill({ projectRoot: "D:/work", target: "T1", runId: "job-1" });
  assert.strictEqual(result.ok, false, "自动化层级是「关」时不叫模型");
  // 停在布局确认却补不了：说清是哪一种停（别只说泛泛的「自动化未开启」）。
  assert.match(result.reason, /停在布局确认/);
  assert.deepStrictEqual(fx.committed, []);
}

async function caseSwitchOff() {
  const fx = harness({ automation: "auto", layoutAutoPass: false, groups: [] });
  const result = await fx.autoFill.fill({ projectRoot: "D:/work", target: "T1", runId: "job-1" });
  /*
   * 布局那一节不动（开关关着），其余节也没东西可补：交回给人，不当失败。
   * 但原因要说「哪一条没满足」—— 界面上那句承诺（没自动出分组时说清是哪一条）靠它兑现。
   */
  assert.strictEqual(fx.committed.length, 0);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /停在布局确认/);
  assert.match(result.reason, /「自动通过」没开/);
}

/* 有图就得让模型真看到图：位图按 data URL 一起给，控件清单照旧。 */
async function caseBitmapGoesToModel() {
  const projectRoot = sandbox(png(1280, 1024));
  const fx = harness({ automation: "assist", layoutAutoPass: true, groups: [], projectRoot: projectRoot });
  await fx.autoFill.fill({ projectRoot: projectRoot, target: "T1", runId: "job-1" });
  assert.strictEqual(fx.inputs.length, 1, "这一步要问模型");
  assert.match(fx.inputs[0].image, /^data:image\/png;base64,/, "本页那张位图按 data URL 一起给模型");
  assert.deepStrictEqual(fx.inputs[0].controls, CONTROLS, "控件清单原样给过去");
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

/* 没图时给空串：指令与实际输入一致（只剩清单，按几何判据）。 */
async function caseNoBitmap() {
  const projectRoot = sandbox();
  const fx = harness({ automation: "assist", layoutAutoPass: true, groups: [], projectRoot: projectRoot });
  await fx.autoFill.fill({ projectRoot: projectRoot, target: "T1", runId: "job-1" });
  assert.strictEqual(fx.inputs[0].image, "", "没有图就是空串，不是「读不出来」");
  fs.rmSync(projectRoot, { recursive: true, force: true });
}

/*
 * 图坏了：这是这一步的输入读不出来，不是模型给不出结果 ——
 * 整句（原因 + 怎么做）交回给人，不写盘、也不算「模型没有给出可用结果」。
 */
async function caseBrokenBitmapBlocks() {
  const projectRoot = sandbox(Buffer.from("这不是一张位图", "utf8"));
  const fx = harness({ automation: "assist", layoutAutoPass: true, groups: [], projectRoot: projectRoot });
  const result = await fx.autoFill.fill({ projectRoot: projectRoot, target: "T1", runId: "job-1" });
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
  ["自动化层级是「关」时不叫模型", caseAutomationOff],
  ["自动通过关着时布局那一节不动", caseSwitchOff],
  ["有图就把位图一起给模型", caseBitmapGoesToModel],
  ["没有图就给空串", caseNoBitmap],
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
