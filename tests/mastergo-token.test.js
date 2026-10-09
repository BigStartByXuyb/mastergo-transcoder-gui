#!/usr/bin/env node
"use strict";

// MasterGo token 的取值顺序：启动参数 > 环境变量 > 本机保存 > ~/.codex/config.toml。
// 跑法：node tests/mastergo-token.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createTokenSource, readConfigToken, tokenTrouble, tokenTroubleText, TOKEN_ENV_KEY
} = require("../lib/mcp-token.js");

const ENV_KEY = TOKEN_ENV_KEY;
const ORIGINAL = process.env[ENV_KEY];

const saved = (value) => ({ readMastergoToken: () => value });

function tempHome(configBody) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-token-"));
  if (configBody) fs.writeFileSync(path.join(home, "config.toml"), configBody, "utf8");
  return home;
}

function withEnv(value, run) {
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  try {
    run();
  }
  finally {
    if (ORIGINAL === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = ORIGINAL;
  }
}

// 四级各有值时必须按顺序取，而不是随便命中一个。
function caseOrder() {
  const home = tempHome('args = ["--token=mg_fromconfig"]\n');
  withEnv("mg_fromenv", () => {
    assert.strictEqual(createTokenSource({ cli: "mg_fromcli", home: home, settings: saved("mg_saved") }).value(), "mg_fromcli");
    assert.strictEqual(createTokenSource({ cli: "", home: home, settings: saved("mg_saved") }).value(), "mg_fromenv");
  });
  withEnv(undefined, () => {
    assert.strictEqual(createTokenSource({ cli: "", home: home, settings: saved("mg_saved") }).value(), "mg_saved");
  });
  assert.strictEqual(createTokenSource({ cli: "", home: home, settings: saved("") }).value(), "mg_fromconfig");
  fs.rmSync(home, { recursive: true, force: true });
}

// 来源标记要跟着现算：环境变量插进来就顶掉本机保存那份，撤掉又回本机保存。
function caseSources() {
  const home = tempHome(null);
  withEnv(undefined, () => {
    const empty = createTokenSource({ cli: "", home: home, settings: saved("") });
    assert.strictEqual(empty.value(), "");
    assert.strictEqual(empty.source(), "");
    const source = createTokenSource({ cli: "", home: home, settings: saved("mg_saved") });
    assert.strictEqual(source.source(), "saved");
    withEnv("mg_fromenv", () => assert.strictEqual(source.source(), "env"));
    assert.strictEqual(source.source(), "saved");
  });
  fs.rmSync(home, { recursive: true, force: true });
}

function caseConfig() {
  const home = tempHome('model_provider = "mastergo"\nargs = ["--token=mg_abc-123", "--x"]\n');
  assert.strictEqual(readConfigToken(home), "mg_abc-123");
  const bare = tempHome('args = ["--token=abc"]\n');
  assert.strictEqual(readConfigToken(bare), "", "不是 mg_ 前缀的不认");
  assert.strictEqual(readConfigToken(path.join(home, "no-such")), "", "目录不存在不抛错");
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
}

/*
 * 插件自己的话没有机器可读的错误码：认「token 出什么事」的判据与说法都只有这一处，
 * 流水线失败与控件查询都来这儿问（缺一份 / 被拒 / 与 token 无关）。
 */
function caseTokenWording() {
  const pluginWords = "缺少 MasterGo token：设置环境变量 " + ENV_KEY + "，或用 -ConfigPath / CODEX_CONFIG 指向含 mastergo 配置的 config.toml（当前尝试: <config.toml 路径>；token 不会写入任何产物）";
  const missing = tokenTrouble(pluginWords);
  assert.strictEqual(missing.code, "NEED_TOKEN");
  assert.match(missing.message, /缺少 MasterGo token/);
  assert.match(missing.hint, /设置 → MasterGo token/, "要说清去哪填");

  // 中文被控制台编码弄乱也不影响判据：认的是 ASCII 标记。
  assert.strictEqual(tokenTrouble("??MasterGo token??" + ENV_KEY + "??").code, "NEED_TOKEN");

  // 只提到配置文件、不关 token 的报错不许被认成这件事；两个标记都要。
  assert.strictEqual(tokenTrouble("config.toml 读不了：-ConfigPath 指向的文件不存在"), null);
  // 引擎自己那句「这份不行」不是这件事：不认它，原样给人看（别把人引到错的方向）。
  assert.strictEqual(tokenTrouble("invalid token mg_xxx：MasterGo 说这份不认"), null);
  assert.strictEqual(tokenTrouble("缺少区域前缀：命令行、登记表、Target 都取不到"), null, "别的话不动");
  assert.strictEqual(tokenTrouble(""), null);
  assert.strictEqual(tokenTrouble(null), null);

  // 只有一个字符串字段的地方（流水线失败）用整句形态：拼法也在这份文件里。
  assert.strictEqual(tokenTroubleText("缺少区域前缀"), "", "不是 token 的事不给整句");
  assert.strictEqual(tokenTroubleText("invalid token mg_xxx"), "", "引擎自己的报错原样给人看");
  assert.strictEqual(tokenTroubleText(pluginWords), missing.message + "：" + missing.hint);
}

try {
  for (const [name, run] of [
    ["取值顺序", caseOrder],
    ["来源标记", caseSources],
    ["config.toml", caseConfig],
    ["token 的说法", caseTokenWording]
  ]) {
    run();
    console.log("  ok  " + name);
  }
  console.log("mastergo-token.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
