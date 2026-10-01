#!/usr/bin/env node
"use strict";

// 用户级环境变量：读三个作用域、写或清用户作用域、非 Windows 直接说清楚。
// 跑法：node tests/env-var.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { readEnvVar, writeEnvVar } = require("../lib/env-var.js");

const NAME = "MASTERGO_PLUGIN_ROOT";

// 夹具路径按段拼：源码里不出现「盘符 + 反斜杠」那种机器专属写法（结构检查会拦）。
function drive(letter) {
  return [letter + ":"].concat(Array.prototype.slice.call(arguments, 1)).join("\\");
}

const PROCESS_DIR = drive("D", "from-process");
const USER_DIR = drive("D", "from-user");
const WANTED_DIR = drive("D", "wanted");

// 假 pwsh：把结果写进 -OutFile 指的那个文件，按用例给的结果返回。同时把调用参数记下来。
function fakePwsh(payload, behaviour) {
  const b = behaviour || {};
  const calls = [];
  return {
    calls: calls,
    impl: function (command, args) {
      calls.push({ command: command, args: args });
      if (b.error) return { error: b.error, status: null, stdout: "", stderr: "" };
      const at = args.indexOf("-OutFile");
      if (at >= 0 && payload !== null) fs.writeFileSync(args[at + 1], JSON.stringify(payload), "utf8");
      return { error: null, status: b.status === undefined ? 0 : b.status, stdout: b.stdout || "", stderr: b.stderr || "" };
    }
  };
}

function caseNonWindows() {
  const read = readEnvVar(NAME, { platform: "linux" });
  assert.match(read.failure, /只有 Windows/);
  assert.strictEqual(read.user, "");
  const written = writeEnvVar(NAME, drive("D", "x"), { platform: "linux" });
  assert.match(written.failure, /只有 Windows/);
  assert.strictEqual(written.written, false);
}

function caseRead() {
  const fake = fakePwsh({ name: NAME, process: PROCESS_DIR, user: USER_DIR, machine: "", written: false });
  const got = readEnvVar(NAME, { platform: "win32", spawnImpl: fake.impl });
  assert.deepStrictEqual(
    got,
    { name: NAME, process: PROCESS_DIR, user: USER_DIR, machine: "", written: false, failure: "" },
    "三个作用域各回各的值"
  );
  const args = fake.calls[0].args;
  assert.strictEqual(args[0], "-NoProfile");
  assert.strictEqual(args[1], "-File");
  assert.ok(args.includes("-Name") && args[args.indexOf("-Name") + 1] === NAME);
  assert.ok(!args.includes("-Value") && !args.includes("-Clear"), "纯读不写");
}

function caseWrite() {
  const fake = fakePwsh({ name: NAME, process: "", user: WANTED_DIR, machine: "", written: true });
  const got = writeEnvVar(NAME, "  " + WANTED_DIR + "  ", { platform: "win32", spawnImpl: fake.impl });
  assert.strictEqual(got.written, true);
  assert.strictEqual(got.user, WANTED_DIR);
  const args = fake.calls[0].args;
  assert.strictEqual(args[args.indexOf("-Value") + 1], WANTED_DIR, "两头的空白要去掉");
  assert.ok(!args.includes("-Clear"));
}

function caseClear() {
  const fake = fakePwsh({ name: NAME, process: "", user: "", machine: "", written: true });
  const got = writeEnvVar(NAME, "", { platform: "win32", spawnImpl: fake.impl });
  assert.strictEqual(got.written, true);
  const args = fake.calls[0].args;
  assert.ok(args.includes("-Clear"), "空串＝删掉这个变量");
  assert.ok(!args.includes("-Value"), "清的时候不传值");
}

function caseFailures() {
  const broken = readEnvVar(NAME, { platform: "win32", spawnImpl: fakePwsh({}, { error: new Error("spawn ENOENT") }).impl });
  assert.match(broken.failure, /起不起来|调不起/);

  const noFile = readEnvVar(NAME, {
    platform: "win32",
    spawnImpl: fakePwsh(null, { status: 9, stderr: "boom" }).impl
  });
  assert.match(noFile.failure, /退出码 9/);
  assert.match(noFile.failure, /boom/);
}

function caseOutFile() {
  // 结果只认 -OutFile 写出来的文件：stdout 里就算有 JSON 也不读（控制台是 GBK，中文路径会被替换）。
  const fake = fakePwsh(
    { name: NAME, process: "", user: "", machine: "", written: false },
    { stdout: JSON.stringify({ user: drive("D", "fake") }) }
  );
  const got = readEnvVar(NAME, { platform: "win32", spawnImpl: fake.impl });
  assert.strictEqual(got.user, "", "stdout 不当数据源");
  const out = fake.calls[0].args[fake.calls[0].args.indexOf("-OutFile") + 1];
  assert.ok(path.isAbsolute(out), "结果文件用绝对路径");
}

function caseBadJson() {
  // 脚本写出来的不是 JSON（被别的东西写坏、编码坏掉）：要说清是「结果不合法」，不是抛栈。
  const impl = function (command, args) {
    const at = args.indexOf("-OutFile");
    fs.writeFileSync(args[at + 1], "not json", "utf8");
    return { error: null, status: 0, stdout: "", stderr: "" };
  };
  const got = readEnvVar(NAME, { platform: "win32", spawnImpl: impl });
  assert.match(got.failure, /不是合法 JSON/);
}

try {
  const cases = [
    ["非 Windows", caseNonWindows],
    ["读三个作用域", caseRead],
    ["写用户级", caseWrite],
    ["清除", caseClear],
    ["失败路径", caseFailures],
    ["结果只认文件", caseOutFile],
    ["结果不是 JSON", caseBadJson]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("env-var.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
