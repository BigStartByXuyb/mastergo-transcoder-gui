#!/usr/bin/env node
"use strict";

// 插件定位：插件只有一处来源（客户端自带那一份，装在安装根 plugins/ 下），
// 找不到时要说清「查过哪儿」，装上新版之后立刻用新的那一版。
// 跑法：node tests/plugin-sources.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { pluginSources, pluginRootsUnder, resolvePluginRoot, INSTALL_PARENT_NAME } = require("../lib/plugin-root.js");
const { createPluginRuntime } = require("../lib/plugin.js");

const MARKER = path.join("skills", "mastergo-to-wpf", "SKILL.md");

function escapeRegExp(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

// 造一份能被认出来的插件：认根只看 SKILL.md，版本读插件自己的清单。
function makePlugin(dir, version) {
  fs.mkdirSync(path.dirname(path.join(dir, MARKER)), { recursive: true });
  fs.writeFileSync(path.join(dir, MARKER), "# " + version + "\n", "utf8");
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ version: version }), "utf8");
  return dir;
}

function sandbox() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gui-plugin-src-"));
  const install = path.join(tmp, "install");
  fs.mkdirSync(install, { recursive: true });
  return { tmp: tmp, install: install, plugins: path.join(install, INSTALL_PARENT_NAME) };
}

// 客户端自带那一份装好之后的样子：<安装根>/plugins/<插件名>/<版本>/。
function installVersion(box, version) {
  return makePlugin(path.join(box.plugins, "mastergo-wpf-transcoder", version), version);
}

function caseSources() {
  const box = sandbox();
  const oldRoot = installVersion(box, "2.3.6");
  const newRoot = installVersion(box, "2.3.7");

  const sources = pluginSources({ installRoot: box.install });
  assert.strictEqual(sources.length, 1, "插件来源只有一处");
  const row = sources[0];
  assert.strictEqual(row.id, "install", "那一条的 id 就是客户端自带");
  assert.strictEqual(row.label, "客户端自带");
  assert.strictEqual(row.kind, "install");
  assert.strictEqual(row.path, box.plugins, "path 是那一处（安装根的 plugins/）");
  assert.strictEqual(row.exists, true);
  assert.strictEqual(row.pluginRoot, newRoot, "同一处有多份时用最高版本");
  assert.strictEqual(row.version, "2.3.7", "版本读插件自己的清单");
  assert.deepStrictEqual(row.found, [newRoot, oldRoot], "认出来的都在清单里，高版本在前");

  const missing = pluginSources({ installRoot: path.join(box.tmp, "not-installed") });
  assert.strictEqual(missing.length, 1);
  assert.strictEqual(missing[0].exists, false, "没装就说没有（照旧列出来）");
  assert.strictEqual(missing[0].pluginRoot, "");
  assert.strictEqual(missing[0].version, "");

  fs.rmSync(box.tmp, { recursive: true, force: true });
}

function caseResolve() {
  const box = sandbox();
  installVersion(box, "2.3.7");
  assert.match(resolvePluginRoot({ installRoot: box.install }), /2\.3\.7$/, "定位取最高的那一版");
  fs.rmSync(box.tmp, { recursive: true, force: true });
}

function caseRuntime() {
  const box = sandbox();
  installVersion(box, "2.3.6");
  const runtime = createPluginRuntime({ installRoot: box.install });

  assert.match(runtime.current().root, /2\.3\.6$/, "现取那一份");
  assert.strictEqual(runtime.failure(), "");
  assert.strictEqual(runtime.sources().length, 1);
  assert.strictEqual(runtime.sources()[0].active, true, "生效的就是它");

  // 装上新版之后 reload：客户端「装完立刻生效」这条就是它。
  const fresh = installVersion(box, "2.3.7");
  runtime.reload();
  assert.strictEqual(runtime.current().root, fresh, "装完重定位就取新的那一版");
  assert.strictEqual(runtime.sources()[0].version, "2.3.7");

  fs.rmSync(box.tmp, { recursive: true, force: true });
}

function caseMissing() {
  const box = sandbox();
  const runtime = createPluginRuntime({ installRoot: box.install });

  assert.strictEqual(runtime.current().root, "", "没装时不是抛栈，是留空由界面说清楚");
  assert.match(runtime.failure(), /找不到 mastergo-wpf-transcoder 插件/);
  assert.match(runtime.failure(), /已查找：/);
  // 「已查找」列的就是那一处（插件只有一处来源），并照实说没有。
  assert.match(runtime.failure(), new RegExp(escapeRegExp(box.plugins)));
  assert.match(runtime.failure(), /（没有）/);
  assert.strictEqual(runtime.sources()[0].active, false, "都没找到就没有生效的那条");

  fs.rmSync(box.tmp, { recursive: true, force: true });
}

// 「列出来」与「用哪一份」是同一判据：插件根摆在 plugins/ 下（装好之后的样子）与
// 直接摆在别处（开发时指着一份源码树）都认；没有插件的位置照旧不算。
function caseRootsUnder() {
  const box = sandbox();
  const inside = makePlugin(path.join(box.plugins, "mastergo-wpf-transcoder"), "2.3.7");
  assert.deepStrictEqual(pluginRootsUnder(box.plugins), [inside], "插件根自己也是插件根（没分版本目录时）");
  assert.deepStrictEqual(pluginRootsUnder(path.join(box.tmp, "elsewhere")), [], "没有插件的位置不算");
  fs.rmSync(box.tmp, { recursive: true, force: true });
}

try {
  const cases = [
    ["来源清单只有客户端自带那一处", caseSources],
    ["定位取最高版本", caseResolve],
    ["装完 reload 立刻生效", caseRuntime],
    ["一份都没有", caseMissing],
    ["一个位置下认哪几份", caseRootsUnder]
  ];
  for (const [name, run] of cases) {
    run();
    console.log("  ok  " + name);
  }
  console.log("plugin-sources.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
