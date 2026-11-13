#!/usr/bin/env node
"use strict";

/*
 * 页面 PNG 的路线门禁：只有含 A 的路线允许暂存、保存与落地。
 * 跑法：node tests/design-image-mode.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createBoard } = require("../lib/board.js");
const designImage = require("../lib/design-image.js");
const { png } = require("./image-fixtures.js");

const LINK = "https://mastergo.com/goto/x?file=204689197363903&layer_id=1872:60904";
const TARGET = "ModePage";

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function makeRuns() {
  const jobs = new Map();
  return {
    start(request) {
      const job = { id: "job-" + (jobs.size + 1), state: "running", request: request, runs: [] };
      jobs.set(job.id, job);
      return job;
    },
    status(id) {
      return jobs.get(id) || null;
    },
    latestFor() {
      return null;
    },
    contract() {
      return [];
    }
  };
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-image-mode-home-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "gui-image-mode-project-"));
  write(path.join(project, "Generated", "runs", TARGET, "dsl.snapshot.json"), JSON.stringify({
    dsl: { nodes: [{ type: "FRAME", id: "1:1", layoutStyle: { width: 1280, height: 1024 } }] }
  }));
  const runs = makeRuns();
  const board = createBoard({
    runs: runs,
    pending: null,
    layout: { register: () => ({ ok: true }) },
    artifacts: { stepsOf: () => [] },
    home: home
  });
  try {
    const bTaskId = board.add({
      projectRoot: project,
      items: [{ link: LINK, target: TARGET, mode: "B" }]
    }).created[0];
    assert.throws(
      () => board.requireImageStage(bTaskId),
      (error) => error.code === "MODE_IMAGE_UNSUPPORTED"
    );
    assert.throws(
      () => board.requireImageWrite({
        id: bTaskId,
        workDir: "",
        target: TARGET
      }),
      (error) => error.code === "MODE_IMAGE_UNSUPPORTED"
    );

    const staged = designImage.stage({
      home: home,
      taskId: bTaskId,
      data: png(1280, 1024).toString("base64")
    });
    assert.ok(fs.existsSync(staged.path), "测试先绕过接口造一份暂存件");
    board.start(bTaskId);
    for (let index = 0; index < 40 && !board.byId(bTaskId).workDir; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.strictEqual(fs.existsSync(staged.path), false, "B 任务轮询时必须清掉误留的暂存图");
    assert.strictEqual(board.byId(bTaskId).state, "running");

    const aTaskId = board.add({
      projectRoot: project,
      items: [{ link: LINK, target: TARGET, mode: "A" }]
    }).created[0];
    assert.doesNotThrow(() => board.requireImageStage(aTaskId), "A 任务仍可暂存页面 PNG");
    const stagedA = designImage.stage({
      home: home,
      taskId: aTaskId,
      data: png(1280, 1024).toString("base64")
    });
    assert.ok(fs.existsSync(stagedA.path), "A 任务的暂存件可以写入");
    console.log("design-image-mode.test.js 全部通过");
  }
  finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
