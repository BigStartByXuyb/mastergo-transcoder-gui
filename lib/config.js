"use strict";

/*
 * 服务自己的默认地址与「换地址」那个环境变量的名字：定义只在这里一份。
 * 接线：server.js 直接读地址；开发时由 scripts/dev-ui.js 取出地址、按这里定义的那个变量名设进环境，
 * 再交给 Vite 的 /api 代理（ui 是独立的包，不读这里的源码）。说明写这两个值的地方是 README.md 的
 * 「跑起来」与「开发」两节；变量名在 Vite 配置里还得再写一次（跨包不能引常量），
 * 由 tests/consistency.test.js 的「字面量只在真值源」把它钉在这几处，别处出现即失败。
 */
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const API_TARGET_ENV = "API_TARGET";

function baseUrl(host, port) {
  return "http://" + host + ":" + port;
}

module.exports = { DEFAULT_HOST, DEFAULT_PORT, API_TARGET_ENV, baseUrl };
