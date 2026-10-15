"use strict";

// 服务日志：按天落盘、只留最近 7 天、写不进去也不抛（闪退时要靠这份日志说话）。
// 跑法：node tests/log.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createLog, KEEP_DAYS } = require("../lib/log.js");

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gui-log-"));
}

function day(offsetDays) {
  const d = new Date(Date.now() - offsetDays * 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function caseWritesByDay() {
  const home = tempHome();
  const file = path.join(home, "logs", "server-" + day(0) + ".log");

  const log = createLog(home);
  log.write("boot", "启动 v1.2.3 pid 42");
  log.write("crash", "未捕获异常：boom");
  // 文件名是这份日志的对外契约：安装根下 logs/server-YYYY-MM-DD.log（断言的是真落盘的名字）。
  assert.deepStrictEqual(fs.readdirSync(path.join(home, "logs")), ["server-" + day(0) + ".log"]);
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^\[\d\d:\d\d:\d\d\] \[boot\] 启动 v1\.2\.3 pid 42\n/);
  assert.ok(text.includes("[crash] 未捕获异常：boom"));

  // 目录不存在时自己建（第一次跑没有 logs/）。
  const nestedHome = path.join(home, "nested", "deep");
  const again = createLog(nestedHome);
  again.write("exit", "进程退出 code=0");
  assert.ok(fs.existsSync(path.join(nestedHome, "logs", "server-" + day(0) + ".log")));
  fs.rmSync(home, { recursive: true, force: true });
}

function casePrunesOldFiles() {
  const home = tempHome();
  const dir = path.join(home, "logs");
  fs.mkdirSync(dir, { recursive: true });
  const old = path.join(dir, "server-" + day(KEEP_DAYS + 3) + ".log");
  const recent = path.join(dir, "server-" + day(KEEP_DAYS - 2) + ".log");
  const other = path.join(dir, "notes.txt");
  fs.writeFileSync(old, "旧日志", "utf8");
  fs.writeFileSync(recent, "还要留着的", "utf8");
  fs.writeFileSync(other, "不是日志", "utf8");

  const log = createLog(home);
  assert.ok(!fs.existsSync(old), "超过保留期的要删掉");
  assert.ok(fs.existsSync(recent), "保留期内的要留着");
  assert.ok(fs.existsSync(other), "不是日志的文件不动");
  log.write("boot", "x");
  fs.rmSync(home, { recursive: true, force: true });
}

function caseNeverThrows() {
  const home = tempHome();
  // 拿一个「已经存在且不是目录」的路径当 home：mkdir 必然失败，写日志不能把调用方带崩。
  const file = path.join(home, "not-a-dir");
  fs.writeFileSync(file, "x", "utf8");
  const log = createLog(file);
  assert.doesNotThrow(() => log.write("boot", "写不进去也不抛"));
  assert.ok(fs.existsSync(file), "原文件不动");
  fs.rmSync(home, { recursive: true, force: true });
}

const cases = [
  ["按天落盘", caseWritesByDay],
  ["只留最近 7 天", casePrunesOldFiles],
  ["写不进去也不抛", caseNeverThrows]
];

for (const [name, run] of cases) {
  run();
  console.log("  ok  " + name);
}
console.log("log.test.js 全部通过");
