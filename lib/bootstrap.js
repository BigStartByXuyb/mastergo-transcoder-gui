"use strict";

/*
 * 安装根那份「壳」的对齐。
 *
 * 客户端是两层：安装根的壳（launch.js + 它自己 require 的那两份）负责「起服务、换版本时把服务换成新版再起」，
 * 真正干活的服务在 versions/<版本>/ 里。应用内更新只往 versions/ 铺新版本、改 current.json —— 壳从来不换，
 * 于是壳里的改动（比如「换版本不再另开窗口」）到不了客户机，只有整包重装才带得上。
 *
 * 谁在用：server.js 启动时对齐一次 —— 当前生效的是哪一版，就把那一版的壳铺回安装根。
 * 边界：只认壳的三份文件（监督进程自己的依赖闭包），不碰 server.js / lib 其余部分 / public；
 * 铺不动不影响这一份能不能跑，调用方按返回值记一行日志就够，不往上抛。
 */

const fs = require("fs");
const path = require("path");

/*
 * 壳自己的依赖闭包：launch.js 起子进程、lib/launch.js 选版与拼命令行、lib/log.js 落监督进程那几行。
 * tests/bootstrap.test.js 反过来读这两份源码里的相对 require，漏一份就红。
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

// 清单里的名字一律用 /（发布件跨平台）：拼路径时拆开，别把 "lib/launch.js" 当成一个文件名。
function fileUnder(root, name) {
  return path.join.apply(path, [root].concat(name.split("/")));
}

/*
 * 把 from（当前生效那一份的目录）的壳铺到 home（安装根）：
 *   updated  内容不一样、已经铺过去的
 *   same     本来就一样的
 *   missing  from 里没有这一份（很老的版本目录里没有壳，跳过就是了）
 *   failure  铺不动的原因（第一处就停），空串＝没出错
 * 先写 .new 再改名：半截文件绝不能留在安装根上，否则客户端下次起不来。
 */
function syncSupervisor(options) {
  const opts = options || {};
  const home = path.resolve(opts.home);
  const from = path.resolve(opts.from);
  const result = { updated: [], same: [], missing: [], failure: "" };
  // 只认同一个安装根下的那一份（versions/<版本>/）：别处的副本不该改这台机器的安装根。
  const relative = path.relative(home, from);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return result;
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
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = target + ".new";
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, target);
      result.updated.push(name);
    }
    catch (error) {
      result.failure = "壳文件 " + name + " 铺不进安装根：" + String((error && error.message) || error);
      break;
    }
  }
  return result;
}

module.exports = { SUPERVISOR_FILES, syncSupervisor };
