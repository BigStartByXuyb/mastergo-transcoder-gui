#!/usr/bin/env node
"use strict";

/*
 * 布局恢复与普通待确认提交共用同一条来源解析：看板任务使用自己的 jobId / 工作目录，
 * 新运行挂回原任务。模型输入与写回分别由既有 layout-groups / confirm 负责。
 * 跑法：node tests/layout-recovery-source.test.js
 */

const assert = require("assert");

const { commitFromSource } = require("../lib/confirm.js");

async function main() {
  let committed = null;
  let attached = null;
  const task = {
    id: "task-1",
    jobId: "job-old",
    workDir: "D:/work/task-1",
    request: {
      target: "DemoPage",
      fileId: "file-1",
      layerId: "layer-1",
      ui: "F1",
      mode: "A"
    }
  };
  const payload = commitFromSource({
    body: {
      projectRoot: "D:/work/task-1",
      target: "DemoPage",
      taskId: task.id,
      groups: [],
      resume: true
    },
    board: {
      byId: (id) => id === task.id ? task : null,
      attach: (id, job) => { attached = { id, job }; }
    },
    confirm: {
      commit: (body) => {
        committed = body;
        return {
          written: [{ path: "D:/work/task-1/Generated/_inputs/DemoPage.layout-groups.json", count: 0 }],
          job: { id: "job-new" },
          resumedFrom: "layoutManifest"
        };
      }
    }
  });
  assert.deepStrictEqual(committed.groups, [], "模型结果交给 confirm 写回");
  assert.strictEqual(committed.runId, "job-old", "看板来源使用任务自己的运行");
  assert.strictEqual(committed.request.origin, "board", "续跑保持看板来源");
  assert.strictEqual(committed.request.projectRoot, "D:/work/task-1");
  assert.deepStrictEqual(attached, { id: "task-1", job: { id: "job-new" } }, "新运行挂回原任务");
  assert.strictEqual(payload.job.id, "job-new");

  attached = null;
  committed = null;
  commitFromSource({
    body: {
      projectRoot: "D:/work/manual",
      target: "ManualPage",
      runId: "job-manual",
      groups: []
    },
    board: {
      byId: () => null,
      attach: () => { throw new Error("非看板来源不能挂任务"); }
    },
    confirm: {
      commit: (body) => {
        committed = body;
        return { written: [], job: null };
      }
    }
  });
  assert.strictEqual(committed.runId, "job-manual", "非看板来源沿用请求自带的运行");
  assert.strictEqual(committed.request, undefined, "非看板来源不伪造看板请求");
  assert.strictEqual(attached, null, "非看板来源不挂回任务");
  console.log("layout-recovery-source.test.js 全部通过");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
