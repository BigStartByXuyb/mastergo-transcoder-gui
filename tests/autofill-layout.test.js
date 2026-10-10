#!/usr/bin/env node
"use strict";

/*
 * 布局自动通过：模型给几组就写几组；一组都没给也算一种结论（空表＝本页没有要声明的分组），
 * 照写并按机械判据往下 —— 与人工确认可以写空表同一口径。
 * 跑法：node tests/autofill-layout.test.js
 */

const assert = require("assert");

const { createAutoFill } = require("../lib/autofill.js");

const CONTROLS = [
  { ref: "1:9", controlType: "IconButton", text: "确定", absX: 0, absY: 0, w: 10, h: 10 },
  { ref: "1:10", controlType: "IconButton", text: "取消", absX: 40, absY: 0, w: 10, h: 10 }
];

/* 三个协作者都用桩：这里只验「模型给了什么、写出去的 payload 是什么」。 */
function harness(options) {
  const committed = [];
  const autoFill = createAutoFill({
    ai: { suggestLayoutGroups: async () => ({ groups: options.groups }) },
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
  return { autoFill: autoFill, committed: committed };
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
  assert.match(result.reason, /自动化未开启/);
  assert.deepStrictEqual(fx.committed, []);
}

async function caseSwitchOff() {
  const fx = harness({ automation: "auto", layoutAutoPass: false, groups: [] });
  const result = await fx.autoFill.fill({ projectRoot: "D:/work", target: "T1", runId: "job-1" });
  // 布局那一节不动（开关关着），其余节也没东西可补：交回给人，不当失败。
  assert.strictEqual(fx.committed.length, 0);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /没有要补的输入|模型没有给出可用结果/);
}

const CASES = [
  ["模型给出分组就照写", caseGroupsWritten],
  ["模型一组没给：空表也是结论", caseEmptyIsAConclusion],
  ["自动化层级是「关」时不叫模型", caseAutomationOff],
  ["自动通过关着时布局那一节不动", caseSwitchOff]
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
