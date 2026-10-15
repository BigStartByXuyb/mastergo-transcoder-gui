#!/usr/bin/env node
"use strict";

// 选文件夹：非 Windows 直接说清楚；Windows 上取消、失败、超时都不能把服务挂住。
// 跑法：node tests/pick-folder.test.js

const assert = require("assert");
const { EventEmitter } = require("events");

const { pickFolder } = require("../lib/pick-folder.js");

// 假的子进程：想退出几次、输出什么，都由用例说了算。
function fakeChild(behaviour) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = function () {
    behaviour.killed = true;
  };
  setImmediate(function () {
    if (behaviour.out) child.stdout.emit("data", behaviour.out);
    if (behaviour.error) {
      child.emit("error", behaviour.error);
      return;
    }
    child.emit("exit", behaviour.code ?? 0);
  });
  return child;
}

async function caseNonWindows() {
  const result = await pickFolder({ platform: "linux" });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /只有 Windows/);
}

async function casePicked() {
  const result = await pickFolder({
    platform: "win32",
    spawnImpl: function () { return fakeChild({ out: "  D:\\MTSSD\\MaxWell.SSDPages  ", code: 0 }); }
  });
  assert.deepStrictEqual(result, { ok: true, path: "D:\\MTSSD\\MaxWell.SSDPages" });
}

async function caseCancelled() {
  const result = await pickFolder({
    platform: "win32",
    spawnImpl: function () { return fakeChild({ code: 0 }); }
  });
  assert.deepStrictEqual(result, { ok: true, path: "" }, "取消就是空路径，不是错误");
}

async function caseFailed() {
  const result = await pickFolder({
    platform: "win32",
    spawnImpl: function () { return fakeChild({ code: 3 }); }
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /退出码 3/);
  const broken = await pickFolder({
    platform: "win32",
    spawnImpl: function () { return fakeChild({ error: new Error("spawn ENOENT") }); }
  });
  assert.strictEqual(broken.ok, false);
  assert.match(broken.reason, /spawn ENOENT/);
}

async function caseTimeout() {
  const behaviour = {};
  const result = await pickFolder({
    platform: "win32",
    timeoutMs: 20,
    spawnImpl: function () {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.kill = function () { behaviour.killed = true; };
      return child;
    }
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /开太久/);
  assert.strictEqual(behaviour.killed, true, "超时要把那个进程收掉");
}

(async function main() {
  const cases = [
    ["非 Windows", caseNonWindows],
    ["选中一个目录", casePicked],
    ["取消", caseCancelled],
    ["打不开", caseFailed],
    ["超时", caseTimeout]
  ];
  for (const [name, run] of cases) {
    await run();
    console.log("  ok  " + name);
  }
  console.log("pick-folder.test.js 全部通过");
})().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
