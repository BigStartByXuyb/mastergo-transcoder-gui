#!/usr/bin/env node
"use strict";

// 「这一份正在跑」的记号：正常退出摘掉、被别人写的记号不动、坏文件当没有、写不进去不抛。
// 跑法：node tests/run-mark.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { markPathOf, readMark, beginRun, endRun } = require("../lib/run-mark.js");

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gui-run-mark-"));
}

// 一、写了就能读回来，位置是安装根 logs/run.json，内容带版本与开始时间（pid 由模块补）。
const home = tempHome();
assert.strictEqual(readMark(home), null, "没写过就是没有");
beginRun(home, { version: "1.2.3", startedAt: "2026-10-08T00:00:00.000Z" });
assert.strictEqual(markPathOf(home), path.join(home, "logs", "run.json"), "记号落在安装根 logs/run.json");
const mark = readMark(home);
assert.strictEqual(mark.version, "1.2.3");
assert.strictEqual(mark.startedAt, "2026-10-08T00:00:00.000Z");
assert.strictEqual(mark.pid, process.pid, "pid 是写这份记号的进程");

// 二、正常退出自己摘掉。
endRun(home);
assert.strictEqual(readMark(home), null, "正常退出后不留记号");

// 三、记号是别人写的（别的 pid）时不动它：那是另一个正在跑的实例留下的。
beginRun(home, { version: "1.2.3", startedAt: "2026-10-08T00:00:00.000Z" });
const raw = JSON.parse(fs.readFileSync(markPathOf(home), "utf8"));
raw.pid = 999999;
fs.writeFileSync(markPathOf(home), JSON.stringify(raw), "utf8");
endRun(home);
assert.strictEqual(readMark(home).pid, 999999, "别人的记号不动");

// 四、坏文件当「没有证据」，不抛。
fs.writeFileSync(markPathOf(home), "{ 坏掉的 json", "utf8");
assert.strictEqual(readMark(home), null, "读不出来就当没有");
assert.doesNotThrow(function () { endRun(home); }, "记号坏了也不抛");

// 五、写不进去也不抛（拿一个「已经存在且不是目录」的路径当 home）。
const blocked = tempHome();
const file = path.join(blocked, "not-a-dir");
fs.writeFileSync(file, "x", "utf8");
assert.doesNotThrow(function () { beginRun(file, { version: "1.2.3", startedAt: "" }); }, "写不进去也不抛");
assert.ok(fs.existsSync(file), "原文件不动");

for (const dir of [home, blocked]) fs.rmSync(dir, { recursive: true, force: true });

process.stdout.write("run-mark ok\n");
