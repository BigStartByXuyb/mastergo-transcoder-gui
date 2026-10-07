"use strict";

/*
 * 启动选版：安装根上的 current.json 指向 versions/<版本>/ 就用那一份，否则用安装根自己这一份。
 *
 * 谁在用：launch.js（start.cmd 调的入口）、lib/update.js 的切换都是写这个指针。
 * 边界：只读指针并判断那一份能不能跑（server.js 在不在）；找不到就退回安装根，绝不因为指针写坏而打不开。
 */

const fs = require("fs");
const path = require("path");

// 子进程用这个退出码告诉监督进程「不是结束，是换一份重来」（换版本、重启客户端那条路）。
// 两端（launch.js 与 lib/routes.js）都从这里取，协议只有这一份。
const RESTART_CODE = 75;

function resolveLaunch(home) {
  const root = path.resolve(home);
  let pointer = null;
  try {
    pointer = JSON.parse(fs.readFileSync(path.join(root, "current.json"), "utf8"));
  }
  catch {
    pointer = null;
  }
  const version = String((pointer && pointer.version) || "");
  if (version) {
    const dir = path.join(root, "versions", version);
    if (fs.existsSync(path.join(dir, "server.js"))) return { dir: dir, version: version, fromPointer: true };
  }
  return { dir: root, version: "", fromPointer: false };
}

/*
 * 监督进程还在不在。子进程是「按 75 退出、等监督进程把自己拉起来」这条协议的一半 ——
 * 那份进程没了（窗口被关掉、被任务管理器杀掉）时，本进程就成了孤儿：再按 75 退出，没有任何人
 * 会把它拉起来，用户看到的就是「切完版本服务就没了、页面打不开」。
 *
 * ppid 就是监督进程；signal 0 只探活、不真发信号。ppid 读不到（0）或它已经不在 → 视为不在。
 */
function supervisorAlive(options) {
  const o = options || {};
  const ppid = o.ppid === undefined ? process.ppid : o.ppid;
  const kill = o.kill || process.kill;
  if (!ppid) return false;
  try {
    kill(ppid, 0);
    return true;
  }
  catch {
    return false;
  }
}

module.exports = { resolveLaunch, supervisorAlive, RESTART_CODE };
