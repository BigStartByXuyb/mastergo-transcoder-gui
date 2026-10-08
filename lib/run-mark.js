"use strict";

// 「这一份正在跑」的记号：安装根 logs/run.json 里记着版本、pid、开始时间。
//
// 为什么要有：子进程被硬杀（控制台窗口被关、任务管理器结束进程）时，它自己来不及写日志，
// 监督进程那一侧也只看到一个退出码 —— 唯一能把「谁、哪一版、什么时候没的」说清楚的，是
// **下一次启动**读到这个没被摘掉的记号。
// 摘记号的判据是「退出钩子跑到了」：正常结束、换版本（退出码 75）、未捕获异常都会走 process.on("exit")
// 而自己摘掉（未捕获异常那几行已经由 lib/log.js 的 [crash] 说过，不必下一次再报）—— 记号专门用来抓
// 「连退出钩子都没跑到」的那种死法。
//
// 读这个记号的两种场合都由这一份定义（别的意思不要自己解释）：
//   启动时（server.js 报上一次）：**还有记号** = 上一次没摘掉 = 那一次是异常结束；
//   退出时（endRun）：只有记号是**自己写的**（pid 相同）才摘；别人写的不动 —— 那是另一个还在跑的实例。
//
// 谁在用：server.js 启动时 begin()、退出时 end()，启动时顺带报上一次没正常退出的那一份。
// 边界：写不进去、读不出来都只当「没有证据」，绝不把启动带崩。

const fs = require("fs");
const path = require("path");

const atomicWrite = require("./atomic-write.js");
const { logDirOf } = require("./log.js");

const FILE_NAME = "run.json";

function markPathOf(home) {
  return path.join(logDirOf(home), FILE_NAME);
}

function readMark(home) {
  try {
    const mark = JSON.parse(fs.readFileSync(markPathOf(home), "utf8"));
    return mark && typeof mark === "object" ? mark : null;
  }
  catch {
    return null;
  }
}

/* 写下「我在跑」：info 里至少带 version 与 startedAt（pid 由这里补）。 */
function beginRun(home, info) {
  try {
    const mark = Object.assign({ pid: process.pid }, info);
    atomicWrite.writeAtomic(markPathOf(home), JSON.stringify(mark, null, 2) + "\n");
  }
  catch {
    // 少一份「上一次怎么没的」的证据，不影响这一次跑。
  }
}

/* 正常退出时摘掉记号；记号已经是别人写的（理论上不会）就不动。 */
function endRun(home) {
  const mark = readMark(home);
  if (!mark || Number(mark.pid) !== process.pid) return;
  try {
    fs.rmSync(markPathOf(home), { force: true });
  }
  catch {
    // 摘不掉就留着：下次启动会把它当成一次异常结束报出来。
  }
}

module.exports = { markPathOf, readMark, beginRun, endRun };
