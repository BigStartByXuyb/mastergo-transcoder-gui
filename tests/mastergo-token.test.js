#!/usr/bin/env node
"use strict";

// MasterGo token 的取值顺序：启动参数 > 环境变量 > 本机保存 > ~/.codex/config.toml。
// 跑法：node tests/mastergo-token.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createTokenSource, readConfigToken } = require("../lib/mcp-token.js");

const ENV_KEY = "MASTERGO_MCP_TOKEN";
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

try {
  for (const [name, run] of [["取值顺序", caseOrder], ["来源标记", caseSources], ["config.toml", caseConfig]]) {
    run();
    console.log("  ok  " + name);
  }
  console.log("mastergo-token.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
