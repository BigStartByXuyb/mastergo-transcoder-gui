#!/usr/bin/env node
"use strict";

/*
 * 插件发布件的约定：名字由打包脚本与 lib/plugin-root.js 定；「打哪一版」由调用方给
 * （--tag 是插件仓库的 tag，--dir 是插件在仓库里的位置）；客户端这边没有 pin 文件。
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
  const out = path.join(base, "out");
  const args = [PACK, "--repo-dir", repo, "--tag", "v1.2.3", "--dir", "plugins/" + pluginRoot.PLUGIN_NAME, "--out", out];

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
  assert.throws(function () {
    node([PACK, "--repo-dir", repo, "--tag", "v9.9.9", "--dir", "plugins/" + pluginRoot.PLUGIN_NAME, "--out", path.join(base, "out2")], { stdio: "pipe" });
  }, /版本/, "tag 与插件声明的版本对不上时要失败");

  // 缺「客户端借以认出插件根」的标记文件：也要失败，不能发一个客户端认不出的包。
  const noMarker = makePluginRepo(base, "3.0.0", { marker: false });
  assert.throws(function () {
    node([PACK, "--repo-dir", noMarker, "--tag", "v3.0.0", "--dir", "plugins/" + pluginRoot.PLUGIN_NAME, "--out", path.join(base, "out3")], { stdio: "pipe" });
  }, /SKILL\.md/, "缺标记文件时要失败");

  // 少给参数要说清楚少了什么（发布作业里参数写错时一眼能看出是哪一个）。
  assert.throws(function () {
    node([PACK, "--repo-dir", repo, "--dir", "plugins/" + pluginRoot.PLUGIN_NAME], { stdio: "pipe" });
  }, /--tag/, "没给 --tag 要报出来");

  /*
   * 路径参数后面没跟值：--out 拿到空串会变成「当前目录」，而打包那一步会先删掉输出目录 ——
   * 这种写法必须在动手之前就回绝。
   */
  assert.throws(function () {
    node([PACK, "--repo-dir", repo, "--tag", "v1.2.3", "--dir", "plugins/" + pluginRoot.PLUGIN_NAME, "--out"], { stdio: "pipe" });
  }, /--out/, "参数没给值要报出来（不能当成当前目录）");

  // 输出目录必给：打包前会先清空它，省略就等于「删某个默认目录」，那是删错地方。
  assert.throws(function () {
    node([PACK, "--repo-dir", repo, "--tag", "v1.2.3", "--dir", "plugins/" + pluginRoot.PLUGIN_NAME], { stdio: "pipe" });
  }, /--out/, "没给 --out 要报出来");
}

function main() {
  assert.strictEqual(pkg.MANIFEST_FILE, source.PLUGIN_MANIFEST_NAME, "清单名与客户端那一半共用 lib/source.js 的定义");
  assert.strictEqual(pkg.MANIFEST_FILE, "plugin-manifest.json", "名字就是发布件里那一份");
  assert.ok(pkg.MANIFEST_FILE.endsWith(".json"), "清单是 json");

  // tag → 版本号用生产代码那条判据（不在这里再写一份正则）。
  assert.strictEqual(pkg.versionOfTag("v1.0.371"), "1.0.371");

  // 插件有自己的版本线：客户端这边**不再**打包它 —— 打包由插件仓库打 tag 时的那条作业做
  // （那个仓库的 .github/workflows/plugin-release.yml 调同一个脚本，实现只有这一份）。
  assert.ok(WORKFLOW.indexOf("pack-plugin.js") < 0, "客户端发布不再打包插件");
  assert.strictEqual(
    source.lineOf("pluginSource").normalize(null).base,
    source.PLUGIN_DEFAULT_BASE,
    "插件线的默认源是插件仓库（常量只有 lib/source.js 一处，不在这里再抄一份字面量）"
  );

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
