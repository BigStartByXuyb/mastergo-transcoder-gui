#!/usr/bin/env node
"use strict";

// 版本更新内容：读一份 changelog.json，给客户端、清单与 release 说明共用。
// 跑法：node tests/changelog.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { readChangelog, notesOf, notesText } = require("../lib/changelog.js");
const { buildManifest } = require("../lib/app-manifest.js");

const ROOT = path.join(__dirname, "..");

function tempDir(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gui-changelog-"));
  if (body !== undefined) fs.writeFileSync(path.join(dir, "changelog.json"), body, "utf8");
  return dir;
}

function caseRepoFile() {
  const entries = readChangelog(ROOT);
  assert.ok(entries.length >= 1, "仓库里那份要能读出来");
  assert.strictEqual(typeof entries[0].version, "string");
  assert.ok(Array.isArray(entries[0].notes));
  // 当前版本必须有一条，更新页要显示「这一版能做什么」。
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  assert.ok(notesOf(ROOT, version).length > 0, "当前版本 " + version + " 要有说明");
  // 清单要带上这一版改了什么：客户端检查更新时就能显示。
  assert.ok(buildManifest(ROOT, version).files["changelog.json"], "changelog.json 要进运行树清单");
}

function caseShapes() {
  const dir = tempDir('[{"version":"1.0.0","date":"2026-01-01","notes":["a","b"]},{"version":"0.9.0"}]');
  assert.deepStrictEqual(notesOf(dir, "1.0.0"), ["a", "b"]);
  assert.deepStrictEqual(notesOf(dir, "0.9.0"), [], "没有 notes 就是空表，不编");
  assert.deepStrictEqual(notesOf(dir, "9.9.9"), [], "没这一版就是空表");
  assert.strictEqual(notesText(dir, "1.0.0"), "MasterGo 转码客户端 v1.0.0\n\n- a\n- b");
  assert.strictEqual(notesText(dir, "9.9.9"), "", "没条目就不给 release 说明");
  fs.rmSync(dir, { recursive: true, force: true });
}

function caseBadInput() {
  assert.deepStrictEqual(readChangelog(tempDir(undefined)), [], "文件不在就是空表");
  const broken = tempDir("{坏");
  assert.deepStrictEqual(readChangelog(broken), [], "读不动就是空表");
  fs.rmSync(broken, { recursive: true, force: true });
  const notArray = tempDir('{"version":"1.0.0"}');
  assert.deepStrictEqual(readChangelog(notArray), [], "不是数组就不认");
  fs.rmSync(notArray, { recursive: true, force: true });
}

try {
  for (const [name, run] of [["仓库里那份", caseRepoFile], ["形状", caseShapes], ["坏输入", caseBadInput]]) {
    run();
    console.log("  ok  " + name);
  }
  console.log("changelog.test.js 全部通过");
}
catch (error) {
  console.error(error);
  process.exitCode = 1;
}
