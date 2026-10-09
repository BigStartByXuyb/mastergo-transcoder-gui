"use strict";

/*
 * 服务自己的默认地址：默认值只在这里一份。
 * 起服务（server.js）与开发时的 Vite 代理（ui/vite.config.ts）都读它；
 * 说明里写这个值的只有 README.md 的「跑起来」一节。
 */
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

function baseUrl(host, port) {
  return "http://" + host + ":" + port;
}

module.exports = { DEFAULT_HOST, DEFAULT_PORT, baseUrl };
