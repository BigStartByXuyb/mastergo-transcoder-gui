"use strict";

/*
 * 启动选版：安装根上的 current.json 指向 versions/<版本>/ 就用那一份，否则用安装根自己这一份。
 *
 * 谁在用：launch.js（start.cmd 调的入口）、lib/update.js 的切换都是写这个指针。
 * 边界：只读指针并判断那一份能不能跑（server.js 在不在）；找不到就退回安装根，绝不因为指针写坏而打不开。
 *
 * 另外一处：起子进程时要不要重读「插件根」那个环境变量（界面在设置页改了它、点重启时）。
 * 环境变量是进程启动时的快照，监督进程自己那份是旧的；不重读的话子进程读到的还是老值。
 */

const fs = require("fs");
const path = require("path");

// 子进程用这两个退出码告诉监督进程「不是结束，是换一份重来」：
//   RESTART    换一份重跑（换版本那条路）
//   RELOAD_ENV 换一份重跑，并且重读一次「插件根」那个环境变量（设置页刚改过它）
// 两端（launch.js 与 lib/routes.js）都从这里取，协议只有这一份。
const RESTART_CODE = 75;
const RELOAD_ENV_CODE = 76;

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
 * 起子进程前，把「插件根」这个环境变量对齐到注册表里的最新值。
 *
 * 只在这几种情况下动手（其余一律沿用继承来的那份，不碰）：
 *   reload 且注册表里有值         → 用它（与继承来的相同就不动）
 *   reload 且注册表里没有、继承来的正是上次从注册表读到的那份 → 去掉它（用户刚把它清了）
 *   reload 且注册表里没有、继承来的是别的来路（命令行临时设的） → 不动
 * seenFromRegistry 由调用方在每次决定后记住，这样「清掉」才敢把继承来的那份也去掉。
 */
function pluginEnvDecision(inherited, scopes, seenFromRegistry) {
  const seen = String(seenFromRegistry || "");
  const current = String(inherited || "");
  if (!scopes || scopes.failure) return { action: "keep", value: "", seen: seen };
  const wanted = String(scopes.user || scopes.machine || "");
  if (wanted) {
    if (wanted === current) return { action: "keep", value: "", seen: wanted };
    return { action: "set", value: wanted, seen: wanted };
  }
  if (current && current === seen) return { action: "remove", value: "", seen: "" };
  return { action: "keep", value: "", seen: seen };
}

module.exports = { resolveLaunch, pluginEnvDecision, RESTART_CODE, RELOAD_ENV_CODE };
