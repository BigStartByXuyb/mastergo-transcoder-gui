"use strict";

// 安装根那份「壳」的对齐。
//
// 客户端是两层：安装根的壳（launch.js + 它 require 的相对模块）负责「起服务、换版本时把服务换成新版再起」，
// 真正干活的服务在 versions/<版本>/ 里。应用内更新只往 versions/ 铺新版本、改 current.json —— 壳从来不换，
// 于是壳里的改动（比如「换版本不再另开窗口」）到不了客户机，只有整包重装才带得上。
//
// 谁在用：server.js 启动时对齐一次 —— 当前生效的是哪一版，就把那一版的壳铺回安装根。
// 边界：只认壳**自己拥有**的那两份（下面那张清单），不碰 server.js / lib 其余部分 / public；
// 铺不动不影响这一份能不能跑，调用方按返回值记一行日志就够，不往上抛。

const fs = require("fs");
const path = require("path");

const atomicWrite = require("./atomic-write.js");
// 「版本目录那层叫什么」只有一处：lib/launch.js（选版与内容库默认布局也读它）。
const { VERSIONS_DIR } = require("./launch.js");

/*
 * 壳拥有的那两份：跟着生效那一版对齐（内容不同就换）。
 * 「服务也在用的模块」（比如 lib/log.js）不能进这张清单 —— 铺回去会把安装根那份「备用版本」还在用的
 * 模块换掉（跨版本混用），不铺又会让新壳配旧模块，两条都不对。壳要用日志之类的东西，得自己带一份，
 * 或者干脆不写（现在是后者：监督进程那几行由服务自己记，见 lib/run-mark.js）。
 * tests/bootstrap.test.js 按源码里的字面量相对 require 反查这张清单（覆盖范围：require("./x") 这种写法，
 * 单双引号都认；动态拼出来的路径不覆盖）。
 */
const SUPERVISOR_FILES = ["launch.js", "lib/launch.js"];

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
  return parts.length >= 2 && parts[0] === VERSIONS_DIR;
}

/* 规划：算出哪几份要换（内容不同的）、哪几份本来就一样、哪几份源里没有。 */
function planSync(home, from) {
  const plan = [];
  const same = [];
  const missing = [];
  for (const name of SUPERVISOR_FILES) {
    const bytes = readIfExists(fileUnder(from, name));
    if (!bytes) {
      missing.push(name);
      continue;
    }
    const target = fileUnder(home, name);
    const before = readIfExists(target);
    if (before && before.equals(bytes)) same.push(name);
    else plan.push({ name: name, target: target, bytes: bytes });
  }
  return { plan: plan, same: same, missing: missing };
}

/* 暂存：把计划里每一份都写成临时件。这一步出错，安装根一点没动。 */
function stageAll(plan) {
  const staged = [];
  for (const item of plan) {
    try {
      staged.push({ item: item, temp: atomicWrite.stage(item.target, item.bytes) });
    }
    catch (error) {
      for (const one of staged) atomicWrite.discard(one.temp);
      return { failure: "壳文件 " + item.name + " 写不出临时件（安装根没动）：" + messageOf(error) };
    }
  }
  return { staged: staged, failure: "" };
}

/* 把一份备份放回原位：放不回去也只好这样（原因由调用方报出去）。 */
function restore(landed) {
  for (const done of landed) {
    atomicWrite.discard(done.target);
    if (!done.backup) continue;
    try {
      fs.renameSync(done.backup, done.target);
    }
    catch {
      // 同上：还原不了也只好这样。
    }
  }
}

/*
 * 一份文件落位：先把旧的挪成 .old 备份（本来没有就不留备份），再把临时件改名成正式名。
 * 抛出去时调用方负责把这一份自己放回（见 landAll）。
 */
function landOne(one) {
  const target = one.item.target;
  const backup = target + ".old";
  let moved = false;
  if (fs.existsSync(target)) {
    atomicWrite.discard(backup);
    fs.renameSync(target, backup);
    moved = true;
  }
  try {
    atomicWrite.land(one.temp, target);
  }
  catch (error) {
    if (moved) restore([{ target: target, backup: backup }]);
    throw error;
  }
  return { target: target, backup: moved ? backup : "" };
}

/*
 * 落位：一份一份来；任何一份失败就把前面几份按备份还原、清掉剩下的临时件 ——
 * 「新 launch.js + 旧 lib/launch.js」这种混版绝不能留在安装根上。
 */
function landAll(staged) {
  const landed = [];
  for (const one of staged) {
    try {
      landed.push(landOne(one));
    }
    catch (error) {
      restore(landed);
      for (const rest of staged) atomicWrite.discard(rest.temp);
      return { failure: "壳文件 " + one.item.name + " 落不了位（已还原）：" + messageOf(error) };
    }
  }
  for (const done of landed) if (done.backup) atomicWrite.discard(done.backup);
  return { failure: "" };
}

/*
 * 把 from（当前生效那一份的目录）的壳铺到 home（安装根）：
 *   updated  这次铺过去的（含给安装根补上的共享件）
 *   same     本来就一样的壳
 *   missing  源里没有这一份（很老的版本目录里没有壳，跳过就是了）
 *   failure  铺不动的原因，空串＝没出错
 * 三步：规划 → 暂存 → 落位（落位自带还原）。
 */
function syncSupervisor(options) {
  const opts = options || {};
  const home = path.resolve(opts.home);
  const from = path.resolve(opts.from);
  const result = { updated: [], same: [], missing: [], failure: "" };
  if (!isVersionDirUnder(home, from)) return result;
  const planned = planSync(home, from);
  result.same = planned.same;
  result.missing = planned.missing;
  if (!planned.plan.length) return result;
  const staged = stageAll(planned.plan);
  if (staged.failure) {
    result.failure = staged.failure;
    return result;
  }
  const landed = landAll(staged.staged);
  if (landed.failure) {
    result.failure = landed.failure;
    return result;
  }
  result.updated = planned.plan.map(function (item) { return item.name; });
  return result;
}

module.exports = { SUPERVISOR_FILES, syncSupervisor };
