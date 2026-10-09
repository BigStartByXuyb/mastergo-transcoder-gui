#!/usr/bin/env node
"use strict";

/*
 * 开发时起前端：把后端地址从唯一那处（lib/config.js）取出来，按同一处的变量名交给 Vite。
 *
 * 为什么不让 ui/ 那边自己去读后端源码：ui 是独立的包，只经 HTTP 与后端打交道。
 * 「这次起的是哪一份后端」属于起服务这一侧的事，由这里给出。
 *
 * 用法：npm run dev:ui（仓库根）。
 */

const { spawn } = require("child_process");
const path = require("path");

const { DEFAULT_HOST, DEFAULT_PORT, API_TARGET_ENV, baseUrl } = require("../lib/config.js");

const env = Object.assign({}, process.env);
env[API_TARGET_ENV] = env[API_TARGET_ENV] || baseUrl(DEFAULT_HOST, DEFAULT_PORT);

/*
 * 直接调 ui 包里那份 Vite（`npm --prefix ui exec -- vite`）：起前端只有这一个入口，
 * ui 那个包不再自带一条不带代理的 dev 脚本。
 */
const child = spawn("npm", ["--prefix", "ui", "exec", "--", "vite"], {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  shell: true,
  env: env
});

child.on("exit", function (code) {
  process.exit(code === null ? 1 : code);
});
