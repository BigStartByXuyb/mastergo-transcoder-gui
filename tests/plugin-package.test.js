#!/usr/bin/env node
"use strict";

/*
 * 插件发布件的约定：名字由打包脚本与 lib/plugin-root.js 定，钉哪一版只在 plugin-pin.json 一处。
 * 门禁不只做文本匹配 —— 这里造一个临时的插件仓库当夹具，真的调一遍打包脚本，
 * 核对产出的 zip 与清单、可复现的哈希，以及两条会拦下来的情况（tag 与声明版本对不上、缺标记文件）。
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
const pkg = require("../scripts/pack-plugin.js");
const pin = require("../plugin-pin.json");
const pluginRoot = require("../lib/plugin-root.js");
const source = require("../lib/source.js");

const PACK = path.join(ROOT, "scripts", "pack-plugin.js");
const WORKFLOW = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const MARKER_PARTS = String(pluginRoot.PLUGIN_MARKER).split(/[\\/]/);

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
function makePluginRepo(baseDir, version, options) {
  const withMarker = !options || options.marker !== false;
  const repo = path.join(baseDir, "plugin-repo-" + version + (withMarker ? "" : "-nomarker"));
  const dir = path.join(repo, "plugins", pluginRoot.PLUGIN_NAME);
  fs.mkdirSync(path.join(dir, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: pluginRoot.PLUGIN_NAME, version: version }));
  if (withMarker) {
    fs.mkdirSync(path.join(dir, ...MARKER_PARTS.slice(0, -1)), { recursive: true });
    fs.writeFileSync(path.join(dir, ...MARKER_PARTS), "# 夹具\n");
  }
  git(repo, ["init", "-q"]);
  // 夹具不跟着本机的换行设置走：清单里的哈希是 tag 里那份内容的哈希。
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "user.email", "ci@example.com"]);
  git(repo, ["config", "user.name", "ci"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "fixture " + version]);
  git(repo, ["tag", "v" + version]);
  return repo;
}

function writePin(baseDir, repo, tag) {
  const file = path.join(baseDir, "pin.json");
  fs.writeFileSync(file, JSON.stringify({ repo: repo, tag: tag, path: "plugins/" + pluginRoot.PLUGIN_NAME }));
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
  // 同一个夹具上顺手验一下判据的正例：打包侧用的是客户端那条「是不是插件根」。
  assert.strictEqual(pluginRoot.isPluginRoot(path.join(repo, "plugins", pluginRoot.PLUGIN_NAME)), true, "夹具应当是插件根");
  const pinFile = writePin(base, repo, "v1.2.3");
  const out = path.join(base, "out");
  const args = [PACK, "--repo-dir", repo, "--out", out, "--pin", pinFile];

  node(args);
  const manifestFile = path.join(out, pkg.MANIFEST_FILE);
  const first = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert.strictEqual(first.name, pluginRoot.PLUGIN_NAME);
  assert.strictEqual(first.version, "1.2.3");
  assert.strictEqual(first.tag, "v1.2.3");
  // 与客户端同一种清单：{相对路径: sha256}，相对路径用正斜杠。
  const markerRel = MARKER_PARTS.join("/");
  assert.ok(first.files[".claude-plugin/plugin.json"], "清单要含插件自己的清单文件");
  assert.strictEqual(
    first.files[markerRel],
    sha256(path.join(repo, "plugins", pluginRoot.PLUGIN_NAME, ...MARKER_PARTS)),
    "清单里那一项要真的是那个文件的哈希"
  );
  // 文件按哈希命名落在 files/ 下（同内容只留一份）。
  const blobs = fs.readdirSync(path.join(out, "files"));
  assert.ok(blobs.indexOf(first.files[markerRel]) >= 0, "按内容哈希暂存了标记文件");

  const firstFiles = JSON.stringify(first.files);
  node(args);
  assert.strictEqual(
    JSON.stringify(JSON.parse(fs.readFileSync(manifestFile, "utf8")).files),
    firstFiles,
    "同一个 tag 打两次，清单里的哈希要一致"
  );

  // tag 与插件自己声明的版本对不上：宁可打不出来。
  git(repo, ["tag", "v9.9.9"]);
  const wrongPin = writePin(base, repo, "v9.9.9");
  assert.throws(function () {
    node([PACK, "--repo-dir", repo, "--out", path.join(base, "out2"), "--pin", wrongPin], { stdio: "pipe" });
  }, /版本/, "tag 与插件声明的版本对不上时要失败");

  // 缺「客户端借以认出插件根」的标记文件：也要失败，不能发一个客户端认不出的包。
  const noMarker = makePluginRepo(base, "3.0.0", { marker: false });
  const noMarkerDir = path.join(base, "nomarker");
  fs.mkdirSync(noMarkerDir, { recursive: true });
  const noMarkerPin = writePin(noMarkerDir, noMarker, "v3.0.0");
  assert.throws(function () {
    node([PACK, "--repo-dir", noMarker, "--out", path.join(base, "out3"), "--pin", noMarkerPin], { stdio: "pipe" });
  }, /SKILL\.md/, "缺标记文件时要失败");
}

function main() {
  assert.strictEqual(pkg.MANIFEST_FILE, "plugin-manifest.json", "清单名只有打包脚本一处定义");
  assert.ok(pkg.MANIFEST_FILE.endsWith(".json"), "清单是 json");

  // pin 只属于发布流程：填全、形状对，而且里面那个目录名必须就是插件名（不然两处名字会各说各话）。
  // tag → 版本号用生产代码那条判据（不在这里再写一份正则）。
  assert.ok(/^\d+(\.\d+)*$/.test(pkg.versionOfTag(pin.tag)), "pin 的 tag 形如 v1.0.371：" + pin.tag);
  assert.strictEqual(pkg.versionOfTag("v1.0.371"), "1.0.371");
  assert.ok(
    source.parseSource({ kind: "github", base: String(pin.repo).trim().replace(/\/+$/, "") }) != null,
    "pin 的仓库要是一个能被发布源接受的基址：" + pin.repo
  );
  assert.strictEqual(String(pin.path).split("/").pop(), pluginRoot.PLUGIN_NAME, "pin 的 path 里那个目录要叫 " + pluginRoot.PLUGIN_NAME);

  // 发布流程取 pin 用的就是这一条命令：跑一遍，保证接线是通的。
  const printed = node([PACK, "--print-pin"]).trim().split("\n");
  assert.deepStrictEqual(
    printed,
    ["repo=" + String(pin.repo).trim().replace(/\/+$/, ""), "tag=" + String(pin.tag).trim()],
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
