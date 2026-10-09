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
 * 谁在用：start.cmd 调它。子进程的安装根环境变量（HOME_ENV）始终指向安装根，
 * 所以 local.json / credentials / board.json / chats.json / versions 永远是同一份。
 */

const { spawn } = require("child_process");
const path = require("path");

const { resolveLaunch, RESTART_CODE, childArgs, SUPERVISED_ENV, HOME_ENV } = require("./lib/launch.js");

const HOME = __dirname;
/*
 * 壳这边不写日志：日志实现（lib/log.js）属于服务。壳要是 require 它，应用内更新把壳换新时就得分清
 * 「这份模块属于谁」——铺回去会把安装根那份「备用版本」还在用的模块换掉（跨版本混用），不铺又会让
 * 新壳配旧模块。所以壳只用自己拥有的那两份（launch.js + lib/launch.js，见 lib/bootstrap.js）。
 * 子进程怎么结束的由它自己记：正常/换版本退出写 [exit]，被硬杀则由下一次启动读 logs/run.json 补报
 * （lib/run-mark.js）；这一侧只把人和控制台要看的那几行打印出来。
 */

function childEnv() {
  /*
   * 壳只用自己拥有的两份文件（本文件 + lib/launch.js）：两个名字都从 lib/launch.js 取；
   * 启动器那一侧（tools/launcher/main.go，另一个语言）只按同一个名字再写一次安装根那一个。
   */
  return Object.assign({}, process.env, { [HOME_ENV]: HOME, [SUPERVISED_ENV]: "1" });
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
      process.stderr.write("起不来：" + String(error && error.message ? error.message : error) + "\n");
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
    const ended = await runOnce(target, firstBoot);
    if (ended.code !== RESTART_CODE) {
      process.stdout.write("子进程退出 code=" + ended.code
        + (ended.signal ? "（信号 " + ended.signal + "）" : "") + "，监督进程跟着退出\n");
      process.exit(ended.code);
    }
    process.stdout.write("按 current.json 换一份接着跑\n");
    firstBoot = false;
  }
}

main();
