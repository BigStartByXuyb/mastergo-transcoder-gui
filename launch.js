#!/usr/bin/env node
"use strict";

/*
 * 启动入口：先按 current.json 选版本，再把 server.js 跑起来。
 *
 * start.cmd 调它：node launch.js [server.js 的那套参数]
 * 版本目录里的那一份跑起来时，MASTERGO_HOME 指向安装根，
 * 所以 local.json / credentials / board.json / versions 始终是同一份，不随版本目录走。
 */

const { spawn } = require("child_process");
const path = require("path");

const { resolveLaunch } = require("./lib/launch.js");

const HOME = __dirname;
const target = resolveLaunch(HOME);

process.stdout.write("版本: " + (target.fromPointer ? "v" + target.version + "（current.json）" : "本地这一份（无指针）") + "\n");

if (target.dir === HOME) {
  require(path.join(HOME, "server.js"));
}
else {
  const child = spawn(process.execPath, [path.join(target.dir, "server.js")].concat(process.argv.slice(2)), {
    cwd: HOME,
    env: Object.assign({}, process.env, { MASTERGO_HOME: HOME }),
    stdio: "inherit"
  });
  child.on("exit", function (code) {
    process.exit(code === null ? 1 : code);
  });
}
