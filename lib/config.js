"use strict";

/*
 * 服务自己的默认地址与「换地址」那个环境变量的名字：都只在这里一份。
 * 起服务（server.js）直接读它；开发时 Vite 的 /api 代理也读它（那是开发工具链的配置，不进包，
 * 应用代码仍然只经 HTTP 与后端打交道）。说明里写这两个值的只有 README.md 的「跑起来」与「开发」两节。
 */
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const API_TARGET_ENV = "API_TARGET";

function baseUrl(host, port) {
  return "http://" + host + ":" + port;
}

module.exports = { DEFAULT_HOST, DEFAULT_PORT, API_TARGET_ENV, baseUrl };
