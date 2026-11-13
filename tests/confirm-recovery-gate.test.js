#!/usr/bin/env node
"use strict";

/*
 * /api/confirm 与 /api/layout-groups/suggest 写分组表时共用同一服务端停点门禁。
 * 用真进程与真 HTTP 入口验证：非恢复停点不落盘，确有缺表停点时仍正常写回。
 * 跑法：node tests/confirm-recovery-gate.test.js
 */

const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const { png } = require("./image-fixtures.js");
const { HOME_ENV } = require("../lib/launch.js");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "server.js");
const PLUGIN = path.join(ROOT, "plugins", "mastergo-wpf-transcoder");
const TARGET = "DemoPage";

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function makeProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gui-confirm-gate-project-"));
  write(
    path.join(projectRoot, "Generated", "_inputs", TARGET + ".layout-group-candidates.json"),
    JSON.stringify({
      schemaVersion: "mw-wpf-layout-group-candidates/1",
      pageTarget: TARGET,
      source: { dslPath: "", dslSha256: "" },
      entries: []
    })
  );
  return projectRoot;
}

function freePort() {
  return new Promise(function (resolve, reject) {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", function () {
      const port = probe.address().port;
      probe.close(function () {
        resolve(port);
      });
    });
  });
}

function startServer(home, port) {
  const child = spawn(
    process.execPath,
    [SERVER, "--host", "127.0.0.1", "--port", String(port), "--no-open", "--plugin", PLUGIN],
    {
      cwd: ROOT,
      env: { ...process.env, [HOME_ENV]: home, NO_PROXY: "127.0.0.1,localhost" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", function (chunk) { output += chunk; });
  child.stderr.on("data", function (chunk) { output += chunk; });
  return new Promise(function (resolve, reject) {
    child.on("error", reject);
    const deadline = Date.now() + 20000;
    (async function poll() {
      while (Date.now() < deadline) {
        if (child.exitCode !== null) {
          reject(new Error("服务提前退出：" + output));
          return;
        }
        try {
          const response = await fetch("http://127.0.0.1:" + port + "/api/health");
          if (response.ok) {
            resolve(child);
            return;
          }
        }
        catch {
          // 还没监听上，接着等。
        }
        await new Promise((done) => setTimeout(done, 200));
      }
      child.kill();
      reject(new Error("服务没起来：" + output));
    })();
  });
}

async function confirm(origin, projectRoot) {
  const response = await fetch(origin + "/api/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectRoot: projectRoot,
      target: TARGET,
      mode: "A",
      groups: [],
      resume: false
    })
  });
  return { status: response.status, body: await response.json() };
}

async function suggest(origin, projectRoot) {
  const response = await fetch(origin + "/api/layout-groups/suggest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectRoot: projectRoot,
      target: TARGET,
      mode: "A",
      resume: false
    })
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  assert.ok(fs.existsSync(PLUGIN), "测试夹具要按客户端自带那一份插件就位");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-confirm-gate-home-"));
  const projectRoot = makeProject();
  const port = await freePort();
  const child = await startServer(home, port);
  const origin = "http://127.0.0.1:" + port;
  try {
    const refused = await confirm(origin, projectRoot);
    assert.strictEqual(refused.status, 400);
    assert.strictEqual(refused.body.error.code, "NOT_LAYOUT_RECOVERY");
    assert.strictEqual(
      fs.existsSync(path.join(projectRoot, "Generated", "_inputs", TARGET + ".layout-groups.json")),
      false,
      "被门禁拒绝的请求不进入写盘"
    );
    const suggestRefused = await suggest(origin, projectRoot);
    assert.strictEqual(suggestRefused.status, 400);
    assert.strictEqual(suggestRefused.body.error.code, "NOT_LAYOUT_RECOVERY");
    assert.strictEqual(
      fs.existsSync(path.join(projectRoot, "Generated", "_inputs", TARGET + ".layout-groups.json")),
      false,
      "自动分组入口同样不能绕过门禁写盘"
    );

    write(path.join(projectRoot, "Generated", "_inputs", TARGET + ".design.png"), png(1280, 1024));
    const suggestAllowed = await suggest(origin, projectRoot);
    assert.strictEqual(suggestAllowed.status, 400);
    assert.strictEqual(suggestAllowed.body.error.code, "NO_ENTRIES", "恢复停点先放行，再由输入判据拒绝空条目");
    const accepted = await confirm(origin, projectRoot);
    assert.strictEqual(accepted.status, 200);
    assert.deepStrictEqual(accepted.body.written, [{
      path: path.join(projectRoot, "Generated", "_inputs", TARGET + ".layout-groups.json"),
      count: 0
    }]);
    assert.strictEqual(accepted.body.job, null, "只写空表时不起运行");
    assert.ok(
      fs.existsSync(path.join(projectRoot, "Generated", "_inputs", TARGET + ".layout-groups.json")),
      "确有分组恢复停点时仍走原来的确认写回"
    );
  }
  finally {
    child.kill();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
  console.log("confirm-recovery-gate.test.js 全部通过");
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
