#!/usr/bin/env node
"use strict";

// 代理兜底：环境里已有代理就不动系统设置、系统里没开就直连、老引擎没有运行时 API 也不报错。
// 系统代理用假 reg 输出顶替，setProxy 用假函数顶替，全程不联网、不改本机设置。
// 跑法：node tests/proxy.test.js

const assert = require("assert");

const { applyProxy } = require("../lib/proxy.js");

const ON = "    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    127.0.0.1:7890\r\n";
const OFF = "    ProxyEnable    REG_DWORD    0x0\r\n    ProxyServer    REG_SZ    127.0.0.1:7890\r\n";
const PER_PROTOCOL = "    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    http=10.0.0.8:8080;https=10.0.0.9:8443\r\n";
const GARBAGE = "    ProxyEnable    REG_DWORD    0x1\r\n    ProxyServer    REG_SZ    not a proxy\r\n";

function registry(stdout, status) {
  return function () { return { status: status === undefined ? 0 : status, stdout: stdout }; };
}

function enabledOnly() {
  return function () {};
}

function main() {
  // 环境里已经有代理：一个字都不动，也不去读系统设置。
  const untouched = { HTTPS_PROXY: "http://10.2.2.2:8080" };
  let setCalled = 0;
  assert.deepStrictEqual(applyProxy({
    env: untouched,
    run: function () { throw new Error("不该读注册表"); },
    setProxy: function () { setCalled += 1; }
  }), { enabled: true, filled: [] });
  assert.strictEqual(setCalled, 1);
  assert.deepStrictEqual(untouched, { HTTPS_PROXY: "http://10.2.2.2:8080" });

  // 环境是空的、系统开着代理：补齐三个变量，fetch 才认。
  const filled = {};
  assert.deepStrictEqual(applyProxy({ env: filled, run: registry(ON), setProxy: enabledOnly() }), {
    enabled: true,
    filled: ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]
  });
  assert.deepStrictEqual(filled, {
    HTTP_PROXY: "http://127.0.0.1:7890",
    HTTPS_PROXY: "http://127.0.0.1:7890",
    NO_PROXY: "localhost,127.0.0.1,::1"
  });

  // 已经有 NO_PROXY 就别覆盖用户写的绕过清单。
  const keepNoProxy = { NO_PROXY: "*.corp.example" };
  assert.deepStrictEqual(applyProxy({ env: keepNoProxy, run: registry(ON), setProxy: enabledOnly() }).filled,
    ["HTTP_PROXY", "HTTPS_PROXY"]);
  assert.strictEqual(keepNoProxy.NO_PROXY, "*.corp.example");

  // 分协议写法取 https 那一项。
  const perProtocol = {};
  applyProxy({ env: perProtocol, run: registry(PER_PROTOCOL), setProxy: enabledOnly() });
  assert.strictEqual(perProtocol.HTTPS_PROXY, "http://10.0.0.9:8443");

  // 开关关着、地址不像代理、非 Windows、注册表读不到：直连，不抛。
  for (const run of [registry(OFF), registry(GARBAGE), registry("", 1)]) {
    const env = {};
    assert.deepStrictEqual(applyProxy({ env: env, run: run, setProxy: enabledOnly() }), { enabled: true, filled: [] });
    assert.deepStrictEqual(env, {});
  }
  const foreign = {};
  assert.deepStrictEqual(applyProxy({
    env: foreign,
    platform: "darwin",
    run: function () { throw new Error("非 Windows 不读注册表"); },
    setProxy: enabledOnly()
  }), { enabled: true, filled: [] });

  // 老引擎没有 setGlobalProxyFromEnv：环境照补，但不谎报已经生效。
  const legacy = {};
  assert.deepStrictEqual(applyProxy({ env: legacy, run: registry(ON), setProxy: null }), {
    enabled: false,
    filled: ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]
  });

  // Windows 上再走一遍真路径：不注入 run，真的读一次系统设置（只读 reg query）。
  if (process.platform === "win32") {
    const live = {};
    assert.strictEqual(applyProxy({ env: live, setProxy: enabledOnly() }).enabled, true);
    if (live.HTTP_PROXY) assert.match(live.HTTP_PROXY, /^https?:\/\/[^ ]+$/);
  }

  process.stdout.write("proxy ok\n");
}

main();
