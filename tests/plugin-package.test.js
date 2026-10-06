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
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const pkg = require("../lib/plugin-package.js");
const pin = require("../plugin-pin.json");
const pluginRoot = require("../lib/plugin-root.js");
const source = require("../lib/source.js");
const WORKFLOW = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");

function main() {
  assert.strictEqual(pkg.PLUGIN_NAME, pluginRoot.PLUGIN_NAME, "插件名只有 lib/plugin-root.js 一处定义");
  // plugin-pin.json 只被发布流程读：这里盯的是它得填全、填对形状（改它不用改代码）。
  // 仓库形态不做主机名限定：GitHub 与公司 GitLab 都要能用（只看它是不是地址拼接器接受的基址）。
  assert.ok(/^v\d+(\.\d+)*$/.test(String(pin.tag).trim()), "pin 的 tag 形如 v1.0.371：" + pin.tag);
  assert.ok(source.parseSource({ kind: "github", base: String(pin.repo).trim().replace(/\/+$/, "") }) != null,
    "pin 的仓库要是一个能被发布源接受的基址：" + pin.repo);
  assert.ok(/^[^/]+\/[^/]+$/.test(String(pin.path).trim().replace(/^\/+|\/+$/g, "")),
    "pin 的 path 形如 plugins/<插件名>：" + pin.path);

  // 随客户端发货的运行时代码不许依赖运行树以外的文件（打包用的 pin 就不是随包发的）。
  const packaged = fs.readFileSync(path.join(ROOT, "lib", "plugin-package.js"), "utf8");
  assert.ok(
    packaged.indexOf('require("../plugin-pin.json")') < 0,
    "运行时代码不 require 发布流程的 pin 文件（它不随包发）"
  );

  // 发布流程取 pin 用的就是这一条命令：这里跑一遍，保证接线是通的（不是只看流程文本里有没有那个名字）。
  const printed = execFileSync(process.execPath, [path.join(ROOT, "scripts", "pack-plugin.js"), "--print-pin"], {
    encoding: "utf8"
  }).trim().split("\n");
  assert.deepStrictEqual(printed, [String(pin.repo).trim().replace(/\/+$/, ""), String(pin.tag).trim()], "打包脚本报出的 pin 要与 plugin-pin.json 一致");
  assert.strictEqual(pkg.zipName("1.2.3"), pkg.PLUGIN_NAME + "-1.2.3.zip", "zip 名字由插件名与版本拼出");

  // 「插件自己声明的版本」只有一条读法：先 .claude-plugin，再回落 .codex-plugin；坏 JSON 不炸、继续试下一个。
  const reader = (files) => (rel) => files[rel] || "";
  assert.strictEqual(pkg.pluginVersionFrom(reader({ ".codex-plugin/plugin.json": '{"version":"9.9.9"}' })), "9.9.9");
  assert.strictEqual(
    pkg.pluginVersionFrom(reader({ ".claude-plugin/plugin.json": "{ 坏", ".codex-plugin/plugin.json": '{"version":"1.0.0"}' })),
    "1.0.0",
    "前一个清单读不动时回落下一个"
  );
  assert.strictEqual(pkg.pluginVersionFrom(reader({})), "", "一个清单都没有时给空");

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
