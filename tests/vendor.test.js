#!/usr/bin/env node
"use strict";

// 发布出去那份能不能自己跑起来：运行树里要有一个 vendor/openai.tgz，解开来就是能加载的 openai。
// 运行树只带那一个压缩件，不带解出来的上千个文件（GitHub 单个 release 的资产名额有限）。
// 跑法：node tests/vendor.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

function caseVendored() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const wanted = String((pkg.dependencies || {}).openai || "").replace(/^[^0-9]*/, "");
  assert.ok(wanted, "package.json 里要声明 openai 依赖");

  const archive = path.join(ROOT, "vendor", "openai.tgz");
  if (!fs.existsSync(archive)) {
    // 本机没铺过就现铺一次：这条链本身要能被这个用例验到。
    const built = spawnSync(process.execPath, [path.join(ROOT, "scripts", "vendor-openai.js")], { stdio: "inherit" });
    assert.strictEqual(built.status, 0, "vendor-openai.js 要能跑通");
  }
  assert.ok(fs.existsSync(archive), "vendor/openai.tgz 要在");

  const extracted = path.join(ROOT, "vendor", "openai", "package.json");
  assert.ok(fs.existsSync(extracted), "解开来要有 vendor/openai");
  assert.strictEqual(JSON.parse(fs.readFileSync(extracted, "utf8")).version, wanted, "版本要与 package.json 声明一致");

  // 清单里只认那一个压缩件：解出来的目录一个都不进（否则一个 release 要传上千个资产）。
  const { buildManifest } = require("../lib/app-manifest.js");
  const files = buildManifest(ROOT, pkg.version).files;
  assert.ok(files["vendor/openai.tgz"], "压缩件要进运行树清单");
  assert.strictEqual(
    Object.keys(files).filter(function (rel) { return rel.indexOf("vendor/openai/") === 0; }).length,
    0,
    "解出来的 vendor/openai 不进清单"
  );

  // 加载一遍：走的就是 lib/ai.js 里那条解析路径。
  delete require.cache[require.resolve("../lib/ai.js")];
  require("../lib/ai.js");
}

try {
  caseVendored();
  console.log("  ok  模型依赖收成一份 vendor/openai.tgz，能解开、能加载、版本一致");
  console.log("vendor.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
