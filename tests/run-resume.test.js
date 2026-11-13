#!/usr/bin/env node
"use strict";

/*
 * /api/run/resume 的真实 HTTP 回归：
 * - 看板任务对应 job 已 done、登记表没跑满时，“继续”按任务与登记表续跑，不返回 ALL_DONE；
 * - 新运行保留看板来源、任务工作目录、Target 和断点。
 * 跑法：node tests/run-resume.test.js
 */

const assert = require("assert");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const { HOME_ENV } = require("../lib/launch.js");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "server.js");
const LINK = "https://mastergo.com/goto/x?file=204689197363903&layer_id=1872:60904";
const TARGET = "ResumePage";

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function makePlugin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-resume-plugin-"));
  const runAll = path.join(root, "skills", "mastergo-to-wpf", "scripts", "entry", "run-all.ps1");
  write(path.join(root, "skills", "mastergo-to-wpf", "SKILL.md"), "# stub\n");
  write(runAll, [
    "param(",
    "  [string]$ProjectRoot, [string]$Mode, [string]$FileId, [string]$LayerId,",
    "  [string]$Target, [string]$Ui, [string]$StopAfter, [string]$Progress,",
    "  [switch]$Overwrite, [switch]$AllowEmptyLedger,",
    "  [switch]$List, [string]$Format, [string]$OutFile",
    ")",
    "if ($List) {",
    "  $steps = @(",
    "    @{ Id = 1; Name = 'discover'; Title = '候选发现'; Inputs = @('x'); Outputs = @('y'); Failures = @('f'); Recovery = @('r') },",
    "    @{ Id = 2; Name = 'ledger'; Title = '图标台账'; Inputs = @('x'); Outputs = @('y'); Failures = @('f'); Recovery = @('r') }",
    "  )",
    "  $steps | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutFile -Encoding utf8",
    "  exit 0",
    "}",
    "if ($Progress -eq 'ledger') {",
    "  $steps = @(",
    "    @{ id = 1; name = 'discover'; status = 'ok'; seconds = 1; note = '' },",
    "    @{ id = 2; name = 'ledger'; status = 'ok'; seconds = 1; note = '' }",
    "  )",
    "}",
    "else {",
    "  $steps = @(@{ id = 1; name = 'discover'; status = 'ok'; seconds = 1; note = '' })",
    "}",
    "$run = @{",
    "  runId = 'stub'; identity = @{ mode = 'mtslg-iocontrol' }; updatedAt = ''; steps = $steps",
    "}",
    "$dir = Join-Path $ProjectRoot ('Generated/runs/' + $Target)",
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    "$run | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $dir 'run.json') -Encoding utf8",
    "exit 0",
    ""
  ].join("\n"));
  return root;
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

function startServer(home, plugin, port) {
  const child = spawn(
    process.execPath,
    [SERVER, "--host", "127.0.0.1", "--port", String(port), "--no-open", "--plugin", plugin],
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

async function post(origin, route, body) {
  const response = await fetch(origin + route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function waitForTask(origin, id, predicate, label) {
  const deadline = Date.now() + 20000;
  let last = null;
  while (Date.now() < deadline) {
    const response = await fetch(origin + "/api/board");
    const body = await response.json();
    const task = body.board.tasks.find(function (item) { return item.id === id; });
    last = task || null;
    if (task && predicate(task)) return task;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error("等超时：" + label + "；最后状态：" + JSON.stringify(last));
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-resume-home-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "gui-resume-project-"));
  const plugin = makePlugin();
  write(path.join(home, "local.json"), JSON.stringify({
    runtime: { system: { node: true, pwsh: true } }
  }));
  write(path.join(project, "demo.txt"), "demo\n");
  const port = await freePort();
  const child = await startServer(home, plugin, port);
  const origin = "http://127.0.0.1:" + port;
  try {
    const added = await post(origin, "/api/board/add", {
      projectRoot: project,
      items: [{ link: LINK, target: TARGET, mode: "B" }]
    });
    assert.strictEqual(added.status, 200, JSON.stringify(added.body));
    const id = added.body.created[0];
    assert.strictEqual((await post(origin, "/api/board/start", { id: id })).status, 200);

    const stopped = await waitForTask(
      origin,
      id,
      function (task) { return task.state === "stopped" && task.jobId; },
      "旧 job 以 done 退出但登记表未跑满"
    );
    assert.strictEqual(stopped.resumable, true);
    assert.strictEqual(stopped.resumeStep, "图标台账");

    const resumed = await post(origin, "/api/run/resume", { taskId: id });
    assert.strictEqual(resumed.status, 200, JSON.stringify(resumed.body));
    assert.strictEqual(resumed.body.resumedFrom, "ledger");
    assert.strictEqual(resumed.body.job.request.origin, "board");
    assert.strictEqual(resumed.body.job.request.projectRoot, stopped.workDir);
    assert.strictEqual(resumed.body.job.request.target, TARGET);
    assert.strictEqual(resumed.body.job.request.progress, "ledger");
  }
  finally {
    child.kill();
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(plugin, { recursive: true, force: true });
  }
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
