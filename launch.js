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

const { resolveLaunch, RESTART_CODE, childArgs } = require("./lib/launch.js");
const { createLog } = require("./lib/log.js");

const HOME = __dirname;
// 与子进程共用同一份日志（logs/server-YYYY-MM-DD.log）：子进程被系统杀掉时，它自己来不及写，
// 这一侧看到的退出码就是唯一证据。
const log = createLog(HOME);

function childEnv() {
  return Object.assign({}, process.env, { MASTERGO_HOME: HOME, MASTERGO_SUPERVISED: "1" });
}

function runOnce(target, firstBoot) {
  return new Promise(function (resolve) {
    const child = spawn(process.execPath, [path.join(target.dir, "server.js")].concat(childArgs(process.argv.slice(2), firstBoot)), {
      cwd: HOME,
      env: childEnv(),
      stdio: "inherit"
    });
    // code 与 signal 都留着：Windows 上被硬杀通常是带码退出（实测 4294967295），
    // 但真按信号终止时要能看出来，别一律记成 code=1。
    child.on("exit", function (code, signal) {
      resolve({ code: code === null ? 1 : code, signal: signal || "" });
    });
    child.on("error", function (error) {
      const text = "起不来：" + String(error && error.message ? error.message : error);
      process.stderr.write(text + "\n");
      log.write("crash", text);
      resolve({ code: 1, signal: "" });
    });
  });
}

async function main() {
  // 只有本次会话第一次起的那一份自己开界面；之后都是换版本/重启换来的，界面会自己回来（见 lib/launch.js 的 childArgs）。
  let firstBoot = true;
  for (;;) {
    const target = resolveLaunch(HOME);
    const which = target.fromPointer ? "v" + target.version + "（current.json）" : "本地这一份（无指针）";
    process.stdout.write("版本: " + which + "\n");
    log.write("boot", "监督进程起 " + which + " pid " + process.pid);
    const ended = await runOnce(target, firstBoot);
    if (ended.code !== RESTART_CODE) {
      log.write("exit", "子进程退出 code=" + ended.code
        + (ended.signal ? "（信号 " + ended.signal + "）" : "") + "，监督进程跟着退出");
      process.exit(ended.code);
    }
    log.write("switch", "按 current.json 换一份接着跑（子进程退出码 " + ended.code + "）");
    process.stdout.write("按 current.json 换一份接着跑\n");
    firstBoot = false;
  }
}

main();
