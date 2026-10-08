"use strict";

// 安装根那份「壳」的对齐。
//
// 客户端是两层：安装根的壳（launch.js + 它 require 的相对模块）负责「起服务、换版本时把服务换成新版再起」，
// 真正干活的服务在 versions/<版本>/ 里。应用内更新只往 versions/ 铺新版本、改 current.json —— 壳从来不换，
// 于是壳里的改动（比如「换版本不再另开窗口」）到不了客户机，只有整包重装才带得上。
//
// 谁在用：server.js 启动时对齐一次 —— 当前生效的是哪一版，就把那一版的壳铺回安装根。
// 边界：只认壳的那几份文件，不碰 server.js / lib 其余部分 / public；铺不动不影响这一份能不能跑，
// 调用方按返回值记一行日志就够，不往上抛。

const fs = require("fs");
const path = require("path");

const atomicWrite = require("./atomic-write.js");

/*
 * 壳自己的依赖闭包：launch.js 起子进程、lib/launch.js 选版与拼命令行、lib/log.js 落监督进程那几行。
 * tests/bootstrap.test.js 按源码里的字面量相对 require 反查这张表（覆盖范围：require("./x") 这种写法，
 * 单双引号都认；动态拼出来的路径不覆盖）。
 *
 * lib/log.js 是壳与服务**共用**的一份（服务自己也用它落盘）。对齐会把它一起换新，所以跨版本时安装根那份
 * 「备用版本」可能停在「旧服务 + 新 lib/log.js」—— 这是刻意接受的：它只有一个入口 createLog(home)，
 * 改它要同时看壳与服务两边。要彻底避免这种混用，得把壳的日志从共享模块里拆出去（没做）。
 */
const SUPERVISOR_FILES = ["launch.js", "lib/launch.js", "lib/log.js"];

function readIfExists(file) {
  try {
    return fs.readFileSync(file);
  }
  catch {
    return null;
  }
}

function messageOf(error) {
  return String((error && error.message) || error);
}

// 清单里的名字一律用 /（发布件跨平台）：拼路径时拆开，别把 "lib/launch.js" 当成一个文件名。
function fileUnder(root, name) {
  return path.join.apply(path, [root].concat(name.split("/")));
}

// 只认安装根下 versions/<版本>/ 那一份（当前生效的版本目录）：别处的副本不该改这台机器的安装根。
function isVersionDirUnder(home, from) {
  const parts = path.relative(home, from).split(path.sep).filter(Boolean);
  return parts.length >= 2 && parts[0] === "versions";
}

/*
 * 把 from（当前生效那一份的目录）的壳铺到 home（安装根）：
 *   updated  内容不一样、已经铺过去的
 *   same     本来就一样的
 *   missing  from 里没有这一份（很老的版本目录里没有壳，跳过就是了）
 *   failure  铺不动的原因，空串＝没出错
 *
 * 三份是**一组**：先把每一份都写成临时件，全都就绪了才开始落位；落位中途出错就把已经换过的按备份还原。
 * 半截文件或「新 launch.js + 旧 lib/launch.js」的混版绝不能留在安装根上，否则客户端下次起不来。
 */
function syncSupervisor(options) {
  const opts = options || {};
  const home = path.resolve(opts.home);
  const from = path.resolve(opts.from);
  const result = { updated: [], same: [], missing: [], failure: "" };
  if (!isVersionDirUnder(home, from)) return result;

  // 一、算清要动哪几份：内容一样的不动，源里没有的跳过。
  const plan = [];
  for (const name of SUPERVISOR_FILES) {
    const bytes = readIfExists(fileUnder(from, name));
    if (!bytes) {
      result.missing.push(name);
      continue;
    }
    const target = fileUnder(home, name);
    const before = readIfExists(target);
    if (before && before.equals(bytes)) {
      result.same.push(name);
      continue;
    }
    plan.push({ name: name, target: target, bytes: bytes });
  }
  if (!plan.length) return result;

  // 二、先把临时件全写出来：这一步出错，安装根一点没动。
  const staged = [];
  for (const item of plan) {
    try {
      staged.push({ item: item, temp: atomicWrite.stage(item.target, item.bytes) });
    }
    catch (error) {
      for (const one of staged) atomicWrite.discard(one.temp);
      result.failure = "壳文件 " + item.name + " 写不出临时件（安装根没动）：" + messageOf(error);
      return result;
    }
  }

  // 三、逐个落位；任何一份失败，把这次换过的按备份放回去，再把临时件清掉。
  const landed = [];
  function rollback() {
    for (const done of landed) {
      atomicWrite.discard(done.target);
      if (done.backup) {
        try {
          fs.renameSync(done.backup, done.target);
        }
        catch {
          // 还原不了也只好这样：下面把原因报出去。
        }
      }
    }
    for (const one of staged) atomicWrite.discard(one.temp);
  }

  for (const one of staged) {
    const target = one.item.target;
    const backup = target + ".old";
    let moved = false;
    try {
      if (fs.existsSync(target)) {
        atomicWrite.discard(backup);
        fs.renameSync(target, backup);
        moved = true;
      }
      atomicWrite.land(one.temp, target);
      landed.push({ target: target, backup: moved ? backup : "" });
    }
    catch (error) {
      if (moved) {
        try {
          fs.renameSync(backup, target);
        }
        catch {
          // 同上：还原不了也只好这样。
        }
      }
      rollback();
      result.failure = "壳文件 " + one.item.name + " 落不了位（已还原）：" + messageOf(error);
      return result;
    }
  }
  for (const done of landed) if (done.backup) atomicWrite.discard(done.backup);
  result.updated = plan.map(function (item) { return item.name; });
  return result;
}

module.exports = { SUPERVISOR_FILES, syncSupervisor };
