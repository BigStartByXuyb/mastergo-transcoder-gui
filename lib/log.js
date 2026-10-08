"use strict";

/*
 * 服务日志：安装根下 logs/server-YYYY-MM-DD.log。
 *
 * 为什么要有：服务平时只把东西打在那个控制台窗口里，窗口一关（或进程被系统杀掉）就什么都不剩，
 * 「程序闪退」这种问题事后只能靠猜。这里落盘的是能回答「谁、什么时候、怎么死的」那几行：
 * 启动（版本 / 端口 / pid / 安装根）、退出码、未捕获异常与未处理拒绝、监督进程看到的子进程退出。
 *
 * 边界：日志写不进去（磁盘满、目录只读）只是少一份日志，不能把服务带崩；只保留最近 KEEP_DAYS 天。
 */

const fs = require("fs");
const path = require("path");

const KEEP_DAYS = 7;
const DIR_NAME = "logs";
const FILE_PREFIX = "server-";
const FILE_SUFFIX = ".log";
const DAY_MS = 86400000;

function pad(value) {
  return String(value).padStart(2, "0");
}

function dayOf() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function stampOf() {
  const d = new Date();
  return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}

/* 删掉超过保留期的旧日志：失败不抛（删不掉就留着）。 */
function prune(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  }
  catch {
    return;
  }
  const today = Date.parse(dayOf());
  for (const name of names) {
    if (!name.startsWith(FILE_PREFIX) || !name.endsWith(FILE_SUFFIX)) continue;
    const day = name.slice(FILE_PREFIX.length, name.length - FILE_SUFFIX.length);
    const age = (today - Date.parse(day)) / DAY_MS;
    if (!Number.isFinite(age) || age < KEEP_DAYS) continue;
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    }
    catch {
      // 删不掉就留着：一份旧日志不该影响服务。
    }
  }
}

/* home 是安装根（MASTERGO_HOME）。scope 用短词：boot / exit / crash / switch。 */
function createLog(home) {
  const dir = path.join(String(home || "."), DIR_NAME);

  function write(scope, text) {
    const line = "[" + stampOf() + "] [" + scope + "] "
      + String(text === undefined || text === null ? "" : text).replace(/\s+$/, "") + "\n";
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, FILE_PREFIX + dayOf() + ".log"), line, "utf8");
    }
    catch {
      // 写不进去不影响服务。
    }
  }

  prune(dir);
  return { write };
}

module.exports = { createLog, KEEP_DAYS };
