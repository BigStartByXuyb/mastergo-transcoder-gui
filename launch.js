#!/usr/bin/env node
"use strict";

/*
 * 启动入口，同时是监督进程：按 current.json 选版本 → 起子进程跑那一份 server.js。
 *
 * 为什么要有监督进程：界面上点「切换版本」要立刻生效，而运行中的那份不能被换文件
 * （换掉脚下正在加载的 server.js / lib，跑一半的请求会混用两版代码）。
 * 所以子进程收到切换请求就以 RESTART_CODE 退出，这里按新指针重新起一份 —— 用户不必自己去重启。
 * 子进程正常结束（关窗口、Ctrl+C、出错）时，这里原样退出。
 *
 * 谁在用：start.cmd 调它。子进程的 MASTERGO_HOME 始终指向安装根，
 * 所以 local.json / credentials / board.json / chats.json / versions 永远是同一份。
 */

const { spawn } = require("child_process");
const path = require("path");

const { resolveLaunch, pluginEnvDecision, RESTART_CODE, RELOAD_ENV_CODE } = require("./lib/launch.js");
const { readEnvVar } = require("./lib/env-var.js");
const { PLUGIN_ENV_NAME } = require("./lib/plugin-root.js");

const HOME = __dirname;

// 上次从注册表读到的那一份：用户把它清掉时，才敢把继承来的那份也去掉。
let lastRegistryValue = "";

function childEnv(reloadPluginEnv) {
  const env = Object.assign({}, process.env, { MASTERGO_HOME: HOME, MASTERGO_SUPERVISED: "1" });
  if (!reloadPluginEnv) return env;
  const decision = pluginEnvDecision(process.env[PLUGIN_ENV_NAME], readEnvVar(PLUGIN_ENV_NAME), lastRegistryValue);
  lastRegistryValue = decision.seen;
  /*
   * 自己那份也要跟着改：env 只是给这一次子进程的副本，而监督进程的 process.env 是启动时的快照。
   * 不改它的话，下一次「换一份重跑」（75，例如切版本）会把刚换掉的值退回旧的、把刚清掉的又找回来。
   */
  if (decision.action === "set") {
    env[PLUGIN_ENV_NAME] = decision.value;
    process.env[PLUGIN_ENV_NAME] = decision.value;
  }
  if (decision.action === "remove") {
    delete env[PLUGIN_ENV_NAME];
    delete process.env[PLUGIN_ENV_NAME];
  }
  return env;
}

function runOnce(target, reloadPluginEnv) {
  return new Promise(function (resolve) {
    const child = spawn(process.execPath, [path.join(target.dir, "server.js")].concat(process.argv.slice(2)), {
      cwd: HOME,
      env: childEnv(reloadPluginEnv),
      stdio: "inherit"
    });
    child.on("exit", function (code) { resolve(code === null ? 1 : code); });
    child.on("error", function (error) {
      process.stderr.write("起不来：" + String(error && error.message ? error.message : error) + "\n");
      resolve(1);
    });
  });
}

async function main() {
  let reloadPluginEnv = false;
  for (;;) {
    const target = resolveLaunch(HOME);
    process.stdout.write("版本: " + (target.fromPointer ? "v" + target.version + "（current.json）" : "本地这一份（无指针）") + "\n");
    const code = await runOnce(target, reloadPluginEnv);
    if (code !== RESTART_CODE && code !== RELOAD_ENV_CODE) process.exit(code);
    reloadPluginEnv = code === RELOAD_ENV_CODE;
    process.stdout.write(reloadPluginEnv ? "按 current.json 换一份接着跑（并重读插件环境变量）\n" : "按 current.json 换一份接着跑\n");
  }
}

main();
