#!/usr/bin/env node
"use strict";

/*
 * 插件发布件的约定：名字只在 lib/plugin-package.js 一处，钉哪一版只在 plugin-pin.json 一处。
 * 门禁不只做文本匹配 —— 这里造一个临时的插件仓库当夹具，真的调一遍打包脚本，
 * 核对产出的 zip 与清单、可复现的哈希、以及「tag 与插件自己声明的版本对不上就打不出来」。
 *
 * 跑法：node tests/plugin-package.test.js
 */

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const pkg = require("../lib/plugin-package.js");
const pin = require("../plugin-pin.json");
const pluginRoot = require("../lib/plugin-root.js");
const source = require("../lib/source.js");

const PACK = path.join(ROOT, "scripts", "pack-plugin.js");
const WORKFLOW = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");

function node(args, options) {
  return execFileSync(process.execPath, args, Object.assign({ encoding: "utf8" }, options || {}));
}

function git(dir, args) {
  return execFileSync("git", ["-C", dir].concat(args), { encoding: "utf8" });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// 一个最小的插件仓库：只有「插件自己的清单」和一个 skill 标记文件（客户端靠后者认出插件根）。
function makePluginRepo(baseDir, version) {
  const repo = path.join(baseDir, "plugin-repo");
  const dir = path.join(repo, "plugins", pkg.PLUGIN_NAME);
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "skills", "mastergo-to-wpf"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: pkg.PLUGIN_NAME, version: version }));
  fs.writeFileSync(path.join(dir, "skills", "mastergo-to-wpf", "SKILL.md"), "# 夹具\n");
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "ci@example.com"]);
  git(repo, ["config", "user.name", "ci"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "fixture " + version]);
  git(repo, ["tag", "v" + version]);
  return repo;
}

function writePin(baseDir, repo, tag) {
  const file = path.join(baseDir, "pin.json");
  fs.writeFileSync(file, JSON.stringify({ repo: repo, tag: tag, path: "plugins/" + pkg.PLUGIN_NAME }));
  return file;
}

/*
 * 真的打一遍：清单里的名字、版本、哈希都要对得上，同一个 tag 打两次哈希一致。
 */
function packTwice() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mgtg-plugin-"));
  try {
    packInto(base);
  }
  finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

function packInto(base) {
  const repo = makePluginRepo(base, "1.2.3");
  const pinFile = writePin(base, repo, "v1.2.3");
  const out = path.join(base, "out");
  const args = [PACK, "--repo-dir", repo, "--out", out, "--pin", pinFile];

  node(args);
  const manifestFile = path.join(out, pkg.MANIFEST_FILE);
  const zipFile = path.join(out, pkg.zipName("1.2.3"));
  const first = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert.strictEqual(first.name, pkg.PLUGIN_NAME);
  assert.strictEqual(first.version, "1.2.3");
  assert.strictEqual(first.tag, "v1.2.3");
  assert.strictEqual(first.zip.name, pkg.zipName("1.2.3"));
  assert.strictEqual(first.zip.sha256, sha256(zipFile), "清单里的哈希要真的是那个 zip 的哈希");
  assert.strictEqual(fs.readFileSync(zipFile).subarray(0, 2).toString("latin1"), "PK", "打出来的是 zip");
  assert.strictEqual(first.zip.sha256, sha256(zipFile));

  const firstHash = first.zip.sha256;
  node(args);
  assert.strictEqual(JSON.parse(fs.readFileSync(manifestFile, "utf8")).zip.sha256, firstHash, "同一个 tag 打两次哈希要一致");

  // tag 与插件自己声明的版本对不上：宁可打不出来。
  const wrongPin = writePin(base, repo, "v9.9.9");
  assert.throws(function () {
    node([PACK, "--repo-dir", repo, "--out", path.join(base, "out2"), "--pin", wrongPin], { stdio: "pipe" });
  }, /版本/, "tag 与插件声明的版本对不上时要失败");
}

function main() {
  assert.strictEqual(pkg.PLUGIN_NAME, pluginRoot.PLUGIN_NAME, "插件名只有 lib/plugin-root.js 一处定义");
  assert.strictEqual(pkg.zipName("1.2.3"), pkg.PLUGIN_NAME + "-1.2.3.zip", "zip 名字由插件名与版本拼出");
  assert.ok(pkg.MANIFEST_FILE.endsWith(".json"), "清单是 json");

  // pin 只属于发布流程：填全、形状对，而且里面那个目录名必须就是插件名（不然两处名字会各说各话）。
  assert.ok(/^v\d+(\.\d+)*$/.test(String(pin.tag).trim()), "pin 的 tag 形如 v1.0.371：" + pin.tag);
  assert.ok(
    source.parseSource({ kind: "github", base: String(pin.repo).trim().replace(/\/+$/, "") }) != null,
    "pin 的仓库要是一个能被发布源接受的基址：" + pin.repo
  );
  assert.strictEqual(String(pin.path).split("/").pop(), pkg.PLUGIN_NAME, "pin 的 path 里那个目录要叫 " + pkg.PLUGIN_NAME);

  // 随客户端发货的运行时代码不许依赖运行树以外的文件（pin 不随包发）。
  const runtime = fs.readFileSync(path.join(ROOT, "lib", "plugin-package.js"), "utf8");
  assert.ok(runtime.indexOf('require("../plugin-pin.json")') < 0, "运行时代码不 require pin（它不随包发）");

  // 发布流程取 pin 用的就是这一条命令：跑一遍，保证接线是通的。
  const printed = node([PACK, "--print-pin"]).trim().split("\n");
  assert.deepStrictEqual(
    printed,
    [String(pin.repo).trim().replace(/\/+$/, ""), String(pin.tag).trim()],
    "打包脚本报出的 pin 要与 plugin-pin.json 一致"
  );
  assert.ok(WORKFLOW.indexOf("pack-plugin.js") >= 0, "发布流程要调插件打包脚本");

  packTwice();
  console.log("plugin-package.test.js 全部通过");
}

try {
  main();
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
