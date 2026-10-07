#!/usr/bin/env node
"use strict";

// 运行管理器的状态机回归：参数与计划、行协议解析、退出码、停止、失败取因、日志偏移、列表。
// 用注入的假子进程驱动，不真的起 pwsh；步骤契约走一份桩 run-all.ps1（只回答 -List）。
// 跑法：node tests/run.test.js

const assert = require("assert");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createRunManager } = require("../lib/run.js");
const { UserError } = require("../lib/errors.js");

const STEPS = [
  { Id: 1, Name: "fetch", Title: "取数" },
  { Id: 2, Name: "capture", Title: "结构化快照" },
  { Id: 3, Name: "svg", Title: "图标几何" },
  { Id: 4, Name: "visibility", Title: "显隐事实" },
  { Id: 5, Name: "mapping", Title: "映射草稿" },
  { Id: 6, Name: "discover", Title: "候选发现" },
  { Id: 7, Name: "ledger", Title: "图标台账" },
  { Id: 8, Name: "layout", Title: "Layout 清单" },
  { Id: 9, Name: "inputs", Title: "Bundle 清单" },
  { Id: 10, Name: "bundle", Title: "页面 XML" },
  { Id: 11, Name: "gates", Title: "门禁" },
  { Id: 12, Name: "verify", Title: "复核" }
];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// 桩插件根：只有一份 run-all.ps1，负责回答「-List -Format json -OutFile」。
function makePluginRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-run-plugin-"));
  const entry = path.join(root, "skills", "mastergo-to-wpf", "scripts", "entry");
  fs.mkdirSync(entry, { recursive: true });
  const steps = STEPS.map((step) => Object.assign({}, step, {
    Inputs: ["x"],
    Outputs: ["y"],
    Failures: ["f"],
    Recovery: ["r"]
  }));
  fs.writeFileSync(path.join(entry, "run-all.ps1"), [
    "param([switch]$List, [string]$Format, [string]$OutFile)",
    "$steps = @'",
    JSON.stringify(steps, null, 2),
    "'@",
    "Set-Content -LiteralPath $OutFile -Encoding UTF8 -Value $steps",
    ""
  ].join("\n"), "utf8");
  return root;
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = (signal) => {
    child.killed = signal || true;
  };
  child.emitLine = (line) => child.stdout.emit("data", Buffer.from(line + "\n", "utf8"));
  child.close = (code) => child.emit("close", code);
  return child;
}

function manager(options = {}) {
  const pluginRoot = options.pluginRoot || makePluginRoot();
  const children = [];
  const calls = [];
  const manager = createRunManager({
    plugin: {
      root: pluginRoot,
      /*
       * 与 pwsh 同一口径：用例显式给一份，运行管理器就不会去解析本机实际装没装。
       * 传空串表示「这一份没有」—— 所以判据是「给没给」，不是「真不真」。
       */
      node: "node" in options ? options.node : process.execPath,
      pwsh: "pwsh" in options ? options.pwsh : "pwsh",
      runAll: path.join(pluginRoot, "skills", "mastergo-to-wpf", "scripts", "entry", "run-all.ps1"),
      runAllExists: options.runAllExists !== false
    },
    spawn: (command, args, spawnOptions) => {
      calls.push({ command, args, spawnOptions });
      const child = fakeChild();
      children.push(child);
      return child;
    },
    // 取值链解析出来的 token：只在设置里填过、没设环境变量的机器，靠这一条才跑得动。
    token: "token" in options ? options.token : ""
  });
  return { manager, children, calls, pluginRoot };
}

function ok(fx, lines) {
  const child = fx.children[fx.children.length - 1];
  for (const line of lines) child.emitLine(line);
  child.close(0);
  return flush();
}

async function casePlanAndRequest() {
  const fx = manager();
  const job = fx.manager.start({
    projectRoot: "D:/proj",
    link: "https://mastergo.com/goto/x?file=204689197363903&layer_id=1872:60904",
    target: "F3Align",
    ui: "F3",
    mode: "AB",
    stopAfter: "discover",
    overwrite: true,
    allowEmptyLedger: true
  });
  assert.deepStrictEqual(job.plan, ["A", "B"], "AB = 先 A 后 B");
  assert.deepStrictEqual(job.runs.map((run) => run.mode), ["mw-wpf", "mtslg-iocontrol"]);
  assert.strictEqual(job.request.fileId, "204689197363903", "链接里解析出 fileId");
  assert.strictEqual(job.request.layerId, "1872:60904");
  assert.strictEqual(job.request.ui, "F3");
  assert.strictEqual(job.request.stopAfter, "discover");
  assert.strictEqual(job.request.overwrite, true);
  assert.strictEqual(job.request.origin, "pipeline", "默认来源是流水线页");
  assert.strictEqual(Object.keys(job.runs[0].steps).length, 12, "步骤表按契约的 12 步");
  assert.strictEqual(job.runs[0].steps[1].title, "取数", "步骤标题取自契约");

  const first = fx.calls[0];
  const command = first.args[first.args.length - 1];
  assert.strictEqual(first.command, "pwsh");
  assert.match(command, /-Mode 'mw-wpf'/, "AB 第一条先跑 A");
  for (const flag of ["-StopAfter 'discover'", "-Ui 'F3'", "-Overwrite", "-AllowEmptyLedger", "-Target 'F3Align'"]) {
    assert.ok(command.includes(flag), "命令行必须带 " + flag);
  }
  await ok(fx, ["[01] 取数", "      ok  1.0s  ", "[02] 结构化快照", "      ok  2.0s  "]);
  await flush();
}

async function caseValidation() {
  const noPipeline = manager({ runAllExists: false });
  assert.throws(
    () => noPipeline.manager.start({ projectRoot: "D:/p" }),
    (error) => error instanceof UserError && error.code === "NO_PIPELINE"
  );

  const fx = manager();
  assert.throws(() => fx.manager.start({ projectRoot: "  " }), (error) => error.code === "NEED_PROJECT");
  assert.throws(() => fx.manager.start({ projectRoot: "D:/p", mode: "C" }), (error) => error.code === "BAD_MODE");

  const job = fx.manager.start({ projectRoot: "D:/p", mode: "B" });
  assert.throws(
    () => fx.manager.start({ projectRoot: "D:/p", mode: "B" }),
    (error) => error.code === "BUSY",
    "同一工程目录同时只允许一次运行"
  );
  fx.manager.start({ projectRoot: "D:/other", mode: "B" });
  await ok(fx, []);
  await flush();
  assert.ok(job.id);

  /*
   * 运行时没备齐（没自带、也没允许用系统那份）：开跑前就拒绝，界面直接显示这句话 ——
   * 丢进 startRun 的 Promise 里抛的话，rejection 没人接，用户什么都看不到。
   */
  const savedHome = process.env.MASTERGO_HOME;
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "gui-run-noruntime-"));
  try {
    process.env.MASTERGO_HOME = emptyHome;
    const bare = manager({ node: "", pwsh: "" });
    assert.throws(
      () => bare.manager.start({ projectRoot: "D:/p", mode: "B" }),
      (error) => error instanceof UserError && error.code === "NO_NODE" && /运行环境/.test(error.hint),
      "没有可用的 node 就不开跑"
    );
    const noPwsh = manager({ node: process.execPath, pwsh: "" });
    assert.throws(
      () => noPwsh.manager.start({ projectRoot: "D:/p", mode: "B" }),
      (error) => error instanceof UserError && error.code === "NO_PWSH",
      "node 有、pwsh 没有：照样在开跑前拦下来"
    );
  }
  finally {
    if (savedHome === undefined) delete process.env.MASTERGO_HOME;
    else process.env.MASTERGO_HOME = savedHome;
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }
}

async function caseLineProtocol() {
  const fx = manager();
  const job = fx.manager.start({ projectRoot: "D:/p", mode: "B" });
  const child = fx.children[0];
  child.emitLine("路线: mtslg-iocontrol");
  child.emitLine("[01] 取数");
  child.emitLine("      ok  1.5s  节点 314");
  child.emitLine("[02] 结构化快照");
  child.emitLine("!! 步骤 2(capture) 失败：覆盖校验未通过");
  child.emitLine("   修好后从这一步继续：-Progress capture");
  child.close(1);
  await flush();

  const status = fx.manager.status(job.id);
  const run = status.runs[0];
  assert.strictEqual(run.state, "failed");
  assert.strictEqual(run.steps[1].state, "ok");
  assert.strictEqual(run.steps[1].seconds, 1.5);
  assert.strictEqual(run.steps[1].note, "节点 314");
  assert.strictEqual(run.steps[2].state, "failed");
  assert.strictEqual(run.failure.stepId, 2);
  assert.strictEqual(run.failure.stepName, "capture");
  assert.match(run.failure.message, /覆盖校验未通过/);
  assert.match(run.failure.resume, /-Progress capture/);
  assert.strictEqual(status.state, "failed");

  const slice = fx.manager.log(job.id, 0);
  assert.match(slice.text, /路线 B（mtslg-iocontrol）/);
  assert.ok(slice.next > 0);
}

async function caseExitCodes() {
  const fx = manager();
  const job = fx.manager.start({ projectRoot: "D:/p", mode: "B" });
  fx.children[0].emitLine("[01] 取数");
  fx.children[0].emitLine("[02] 结构化快照");
  fx.children[0].close(0);
  await flush();
  const done = fx.manager.status(job.id);
  assert.strictEqual(done.state, "done");
  assert.strictEqual(done.runs[0].state, "done");
  assert.strictEqual(done.runs[0].steps[1].state, "ok", "结束时还在跑的步骤算完成");
  assert.strictEqual(done.runs[0].steps[2].state, "ok", "开始过但没等到 ok 行的步骤，结束时算完成");
  assert.strictEqual(done.runs[0].steps[3].state, "skipped", "没轮到的步骤算跳过");

  // 进步骤之前就退出：没有 "!! 步骤" 行，原因取最后一行有内容的输出。
  const pre = manager();
  const preJob = pre.manager.start({ projectRoot: "D:/p2", mode: "B" });
  pre.children[0].emitLine("Exception: run-all.ps1:449");
  pre.children[0].emitLine("Line |");
  pre.children[0].emitLine("     | 缺少区域前缀：必须显式给出");
  pre.children[0].close(1);
  await flush();
  const failed = pre.manager.status(preJob.id);
  assert.strictEqual(failed.runs[0].failure.stepId, 0);
  assert.match(failed.runs[0].failure.message, /缺少区域前缀/);
  assert.strictEqual(pre.manager.status(preJob.id).state, "failed");

  // 完全没有输出：兜底文案说明是进入步骤前退出，并带上退出码。
  const empty = manager();
  const emptyJob = empty.manager.start({ projectRoot: "D:/p3", mode: "B" });
  empty.children[0].close(7);
  await flush();
  assert.match(empty.manager.status(emptyJob.id).runs[0].failure.message, /exit 7/);
}

async function caseAbStopsAfterFirstFailure() {
  const fx = manager();
  const job = fx.manager.start({ projectRoot: "D:/p", mode: "AB" });
  fx.children[0].emitLine("!! 步骤 1(fetch) 失败：登记表有多条页面");
  fx.children[0].close(1);
  await flush();
  const status = fx.manager.status(job.id);
  assert.strictEqual(status.runs.length, 2);
  assert.strictEqual(status.runs[0].state, "failed");
  assert.strictEqual(status.runs[1].state, "pending", "A 失败就不再跑 B");
  assert.strictEqual(fx.children.length, 1, "只起了一个子进程");
  assert.strictEqual(status.state, "failed");
}

async function caseStop() {
  const fx = manager();
  const job = fx.manager.start({ projectRoot: "D:/p", mode: "B" });
  fx.children[0].emitLine("[01] 取数");
  const stopped = fx.manager.stop(job.id);
  assert.strictEqual(stopped.state, "stopping", "停止是异步的：先进入 stopping，子进程退出后才是 stopped");
  assert.strictEqual(stopped.runs[0].state, "stopped");
  assert.ok(fx.children[0].killed, "必须真的给子进程发信号");
  fx.children[0].close(null);
  await flush();
  const after = fx.manager.status(job.id);
  assert.strictEqual(after.state, "stopped");
  assert.strictEqual(after.runs[0].state, "stopped");

  assert.throws(() => fx.manager.stop("nope"), (error) => error.code === "NO_JOB");
}

/*
 * 客户机上跑流水线时真遇到的两件事：
 * 1) token 只在「设置」里填过（环境变量里没有）—— 插件脚本只认环境变量，解析出来的那份必须交给子进程；
 * 2) PowerShell 的错误框会带终端色码（ESC[31;1m 之类）—— 日志与失败原因里不该出现它们。
 */
async function caseTokenAndAnsi() {
  const fx = manager({ token: "mg_用例_token" });
  const job = fx.manager.start({ projectRoot: "D:/proj", mode: "B", target: "T1", ui: "F1" });
  assert.strictEqual(fx.calls[0].spawnOptions.env.MASTERGO_MCP_TOKEN, "mg_用例_token", "token 要交给子进程");

  const child = fx.children[0];
  child.emitLine("\u001b[31;1m     | \u001b[31;1m缺少 MasterGo token：中文测试\u001b[0m");
  child.close(1);
  await flush();

  const log = fx.manager.log(job.id, 0).text;
  assert.ok(log.indexOf("\u001b") < 0, "日志里不许留色码");
  assert.ok(log.includes("缺少 MasterGo token：中文测试"), "文案本身要留下");
  assert.strictEqual(
    fx.manager.status(job.id).runs[0].failure.message,
    "缺少 MasterGo token：中文测试",
    "失败原因里的色码也剥掉"
  );

  // 没有 token 时不塞空值：让插件按它自己的 config.toml 兜底去。
  const plain = manager();
  plain.manager.start({ projectRoot: "D:/proj2", mode: "B", target: "T2", ui: "F1" });
  assert.strictEqual("MASTERGO_MCP_TOKEN" in plain.calls[0].spawnOptions.env, false, "没解析出 token 就不设这个变量");
}

  async function caseSpawnError() {
  const fx = manager();
  const job = fx.manager.start({ projectRoot: "D:/p", mode: "B" });
  fx.children[0].emit("error", new Error("ENOENT"));
  await flush();
  const status = fx.manager.status(job.id);
  assert.strictEqual(status.runs[0].state, "failed");
  assert.match(status.runs[0].failure.message, /调不起 pwsh：ENOENT/);
}

async function caseLogOffsetAndTruncation() {
  const fx = manager();
  const job = fx.manager.start({ projectRoot: "D:/p", mode: "B" });
  fx.children[0].emitLine("第一行");
  const first = fx.manager.log(job.id, 0);
  const second = fx.manager.log(job.id, first.next);
  assert.strictEqual(second.text, "", "从末尾继续读没有新内容");
  // 触发滚动丢弃：一次灌进超过上限的文本，再从头读就会被标成 truncated。
  fx.children[0].stdout.emit("data", Buffer.from("x".repeat(600 * 1024) + "\n", "utf8"));
  const truncated = fx.manager.log(job.id, 0);
  assert.strictEqual(truncated.truncated, true);
  fx.children[0].close(0);
  await flush();
  assert.throws(() => fx.manager.log("nope", 0), (error) => error.code === "NO_JOB");
}

async function caseListCurrentAndLookup() {
  const fx = manager();
  const a = fx.manager.start({ projectRoot: "D:/a", target: "T1", mode: "B" });
  await ok(fx, []);
  const aAgain = fx.manager.start({ projectRoot: "D:/a", target: "T1", mode: "B", progress: "layout" });
  const b = fx.manager.start({ projectRoot: "D:/b", target: "T2", mode: "B", origin: "board" });
  const list = fx.manager.list();
  assert.strictEqual(list.filter((item) => item.projectRoot === "D:/a").length, 1, "同工程+同 Target 只留最近一次");
  assert.strictEqual(list.find((item) => item.projectRoot === "D:/a").id, aAgain.id);
  assert.ok(fx.manager.status(a.id), "旧 job 仍然可按 id 取到状态");
  assert.strictEqual(fx.manager.status(a.id).state, "done");
  assert.strictEqual(fx.manager.status("nope"), null);
  assert.strictEqual(fx.manager.latestFor("D:/a").id, aAgain.id, "按工程目录反查最近一次");
  assert.strictEqual(fx.manager.latestFor("D:/missing"), null);
  assert.strictEqual(fx.manager.current().id, aAgain.id, "当前 job 只认流水线页发起的");
  assert.ok(b.id);
  fx.children[1].close(0);
  fx.children[2].close(0);
  await flush();
}

async function caseContract() {
  const fx = manager();
  const contract = fx.manager.contract();
  assert.strictEqual(contract.length, 12);
  assert.strictEqual(contract[0].Name, "fetch");
  assert.deepStrictEqual(contract[0].Inputs, ["x"]);
  assert.strictEqual(fx.manager.contract().length, 12, "契约只读一次并缓存");
}

async function main() {
  const cases = [
    ["计划与命令行参数", casePlanAndRequest],
    ["输入校验与并发拒绝", caseValidation],
    ["行协议与失败取因", caseLineProtocol],
    ["退出码与步骤收尾", caseExitCodes],
    ["AB 第一条失败不再跑第二条", caseAbStopsAfterFirstFailure],
    ["停止", caseStop],
    ["起不来子进程", caseSpawnError],
    ["token 交给子进程 + 色码剥掉", caseTokenAndAnsi],
    ["日志偏移与截断", caseLogOffsetAndTruncation],
    ["列表 / 反查 / 当前 job", caseListCurrentAndLookup],
    ["步骤契约", caseContract]
  ];
  for (const [name, run] of cases) {
    await run();
    console.log("  ok  " + name);
  }
  console.log("run.test.js 全部通过");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
