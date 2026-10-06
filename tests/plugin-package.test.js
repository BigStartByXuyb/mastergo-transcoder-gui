#!/usr/bin/env node
"use strict";

/*
 * 插件发布件的约定：名字与来源只有 lib/plugin-package.js 一处，发布流程必须打同一个名字。
 * 只做文本级检查（流程是 YAML，跨语言没法直接调），盯的是「不许悄悄改名、不许两处各说各话」。
 *
 * 跑法：node tests/plugin-package.test.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const pkg = require("../lib/plugin-package.js");
const WORKFLOW = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");

function main() {
  assert.ok(/^v\d+(\.\d+)*$/.test(pkg.PLUGIN_TAG), "钉住的插件 tag 形如 v1.0.371：" + pkg.PLUGIN_TAG);
  assert.ok(
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/.test(pkg.PLUGIN_REPO),
    "插件仓库是一个仓库基址（不带 /releases）：" + pkg.PLUGIN_REPO
  );
  assert.strictEqual(pkg.zipName("1.2.3"), pkg.PLUGIN_NAME + "-1.2.3.zip", "zip 名字由插件名与版本拼出");
  assert.ok(pkg.MANIFEST_FILE.endsWith(".json"), "清单是 json");

  assert.ok(WORKFLOW.indexOf("scripts/pack-plugin.js") >= 0, "发布流程要调插件打包脚本");
  assert.ok(WORKFLOW.indexOf(pkg.MANIFEST_FILE) >= 0, "发布流程传的清单名要与客户端要找的一致");
  assert.ok(WORKFLOW.indexOf(pkg.PLUGIN_NAME) >= 0, "发布流程传的 zip 名要与客户端要找的一致");

  console.log("plugin-package.test.js 全部通过");
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
