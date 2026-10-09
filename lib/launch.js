"use strict";

/*
 * 启动选版：安装根上的 current.json 指向 versions/<版本>/ 就用那一份，否则用安装根自己这一份。
 *
 * 谁在用：launch.js（start.cmd 调的入口）、lib/update.js 的切换都是写这个指针。
 * 边界：只读指针并判断那一份能不能跑（server.js 在不在）、以及给子进程拼命令行（childArgs）；
 * 找不到要跑的那一份就退回安装根，绝不因为指针写坏而打不开。
 */

const fs = require("fs");
const path = require("path");

// 子进程用这个退出码告诉监督进程「不是结束，是换一份重来」（换版本、重启客户端那条路）。
// 两端（launch.js 与 lib/routes.js）都从这里取，协议只有这一份。
const RESTART_CODE = 75;

/*
 * 「这一份是被监督进程拉起来的」那个环境变量名：壳那一侧（launch.js）设它，服务这一侧（server.js）读它。
 * 壳只用自己拥有的两份文件（launch.js + 本模块），所以这个名字定义在这里、两端都从这里取。
 */
const SUPERVISED_ENV = "MASTERGO_SUPERVISED";

/*
 * 安装根从哪来：壳那一侧（launch.js）与启动器（tools/launcher，另一个语言）都按这个名字写进子进程环境，
 * 服务这一侧（lib/runtime.js）读它。定义在这里 —— 壳与启动器都拥有的那份模块。
 */
const HOME_ENV = "MASTERGO_HOME";

// 安装根上放各版本的那一层目录名：选版（这里）、内容库的默认布局（lib/bundle-store.js）、
// 壳对齐时认「生效的是不是版本目录」（lib/bootstrap.js）都读这一份。
const VERSIONS_DIR = "versions";

/*
 * 起子进程时给它的参数：命令行原样透传，只按「是不是本次会话第一次起」决定要不要自己开界面。
 * 第一次（用户双击 start.cmd / exe）照旧起完开界面；之后每一份都是被「切版本 / 更新 / 重启客户端」
 * 换来的，界面那边自己会 reload 回来（ui 的 restartAndWait 在等它），再开一次只会多弹一个窗口 ——
 * 所以从那之后补上 --no-open。
 */
function childArgs(argv, firstBoot) {
  const args = (argv || []).slice();
  // 命令行本来就没让开界面（比如 npm run api）就不再补一个。
  if (!firstBoot && args.indexOf("--no-open") < 0) args.push("--no-open");
  return args;
}

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
    const dir = path.join(root, VERSIONS_DIR, version);
    if (fs.existsSync(path.join(dir, "server.js"))) return { dir: dir, version: version, fromPointer: true };
  }
  return { dir: root, version: "", fromPointer: false };
}

module.exports = { resolveLaunch, RESTART_CODE, childArgs, VERSIONS_DIR, SUPERVISED_ENV, HOME_ENV };
