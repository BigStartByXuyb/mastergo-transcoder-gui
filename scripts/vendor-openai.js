#!/usr/bin/env node
"use strict";

/*
 * 把模型依赖（openai，零传递依赖）从 node_modules 收成一份随包走的压缩件：
 *   vendor/openai.tgz   发布件与更新清单里的那一个文件（按需解压，不占上千个资产名额）
 *   vendor/openai/      解压出来的那一份，开发机上直接就能用
 *
 * 用法：node scripts/vendor-openai.js
 * 谁在用：CI 的 release job（发布前跑一次）、本机想手工打包时。
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "node_modules", "openai");
const VENDOR = path.join(ROOT, "vendor");
const EXTRACTED = path.join(VENDOR, "openai");
const ARCHIVE = path.join(VENDOR, "openai.tgz");

function run(command, args, options) {
  const result = spawnSync(command, args, Object.assign({ stdio: "inherit" }, options || {}));
  if (result.status !== 0) throw new Error(command + " 退出码 " + result.status);
}

function main() {
  if (!fs.existsSync(path.join(SOURCE, "index.js"))) {
    throw new Error("先 npm ci：node_modules/openai 不在（" + SOURCE + "）");
  }
  const version = JSON.parse(fs.readFileSync(path.join(SOURCE, "package.json"), "utf8")).version;

  fs.mkdirSync(VENDOR, { recursive: true });
  fs.rmSync(EXTRACTED, { recursive: true, force: true });
  fs.rmSync(ARCHIVE, { force: true });
  // 打包时排掉 src（TypeScript 源，运行期用不到），包体因此小一半。
  run("tar", ["-czf", ARCHIVE, "-C", path.join(ROOT, "node_modules"), "--exclude", "openai/src", "openai"]);
  run("tar", ["-xzf", ARCHIVE, "-C", VENDOR]);
  if (!fs.existsSync(path.join(EXTRACTED, "index.js"))) {
    throw new Error("解压后没找到 vendor/openai/index.js");
  }
  const size = (fs.statSync(ARCHIVE).size / 1048576).toFixed(1);
  process.stdout.write("openai " + version + " → vendor/openai.tgz（" + size + " MB），并解到 vendor/openai\n");
}

main();
