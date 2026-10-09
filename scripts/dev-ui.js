#!/usr/bin/env node
"use strict";

/*
 * 开发时起前端：把后端地址从唯一那处（lib/config.js）取出来，设成 API_TARGET 交给 Vite。
 *
 * 为什么不让 ui/vite.config.ts 自己去读后端源码：前端与后端只经 HTTP 打交道（分层），
 * 「这次起的是哪一份后端」属于起服务这一侧的事，由这里给出。
 *
 * 用法：npm run dev:ui（仓库根）；后端换过端口时用 API_TARGET 覆盖。
 */

const { spawn } = require("child_process");
const path = require("path");

const { DEFAULT_HOST, DEFAULT_PORT, baseUrl } = require("../lib/config.js");

const env = Object.assign({}, process.env, {
  API_TARGET: process.env.API_TARGET || baseUrl(DEFAULT_HOST, DEFAULT_PORT)
});

const child = spawn("npm", ["--prefix", "ui", "run", "dev"], {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  shell: true,
  env: env
});

child.on("exit", function (code) {
  process.exit(code === null ? 1 : code);
});
