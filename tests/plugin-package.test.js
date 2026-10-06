#!/usr/bin/env node
"use strict";

/*
 * 插件发布件的约定：名字与来源只在 lib/plugin-package.js（+ plugin-pin.json）一处，
 * 发布流程只调打包脚本、不自己拼名字。只做文本级检查（流程是 YAML，跨语言没法直接调），
 * 盯的是「不许悄悄改名、不许两处各说各话」。
 *
 * 跑法：node tests/plugin-package.test.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const pkg = require("../lib/plugin-package.js");
const pin = require("../plugin-pin.json");
const pluginRoot = require("../lib/plugin-root.js");
const WORKFLOW = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");

function main() {
  assert.strictEqual(pkg.PLUGIN_NAME, pluginRoot.PLUGIN_NAME, "插件名只有 lib/plugin-root.js 一处定义");
  assert.ok(/^v\d+(\.\d+)*$/.test(pkg.PLUGIN_TAG), "钉住的插件 tag 形如 v1.0.371：" + pkg.PLUGIN_TAG);
  assert.ok(
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/.test(pkg.PLUGIN_REPO),
    "插件仓库是一个仓库基址（不带 /releases）：" + pkg.PLUGIN_REPO
  );
  assert.strictEqual(pkg.PLUGIN_TAG, String(pin.tag).trim(), "钉住的 tag 以 plugin-pin.json 为准");
  assert.strictEqual(pkg.PLUGIN_REPO, String(pin.repo).trim().replace(/\/+$/, ""), "钉住的仓库以 plugin-pin.json 为准");
  assert.strictEqual(pkg.zipName("1.2.3"), pkg.PLUGIN_NAME + "-1.2.3.zip", "zip 名字由插件名与版本拼出");

  assert.ok(WORKFLOW.indexOf("scripts/pack-plugin.js") >= 0, "发布流程要调插件打包脚本");
  // 名字只在模块里定义：流程里再写一遍就等于同一件事有两处实现，改名时必有一处漏掉。
  assert.ok(WORKFLOW.indexOf(pkg.MANIFEST_FILE) < 0, "流程里不该再写一遍清单名");
  assert.ok(WORKFLOW.indexOf(pkg.PLUGIN_NAME + "-") < 0, "流程里不该再写一遍 zip 名");

  console.log("plugin-package.test.js 全部通过");
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
