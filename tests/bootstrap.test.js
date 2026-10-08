#!/usr/bin/env node
"use strict";

/*
 * 安装根那份「壳」的对齐：生效那一份是 versions/<版本>/ 时，把它的壳铺回安装根；
 * 一样的不动、不同一个安装根下的副本不碰、铺不动只报原因不抛。
 * 跑法：node tests/bootstrap.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { SUPERVISOR_FILES, syncSupervisor } = require("../lib/bootstrap.js");

const ROOT = path.join(__dirname, "..");

function write(root, rel, text) {
  const file = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, ...rel.split("/")), "utf8");
}

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-bootstrap-"));
  // 安装根那份壳：老内容（比如没有 childArgs 的那一版）。
  write(home, "launch.js", "// 老壳\n");
  write(home, "lib/launch.js", "// 老的选版\n");
  return home;
}

function versionDir(home, version, files) {
  const dir = path.join(home, "versions", version);
  for (const rel of Object.keys(files)) write(dir, rel, files[rel]);
  return dir;
}

const NEW_SHELL = {
  "launch.js": "// 新壳（带 childArgs）\n",
  "lib/launch.js": "// 新的选版\n",
  "lib/log.js": "// 新的日志\n"
};

// 第一遍：三份都不一样（log.js 是安装根原来没有的）→ 全铺过去，内容跟生效那一份一致。
const home = sandbox();
const dir = versionDir(home, "9.9.9", NEW_SHELL);
const first = syncSupervisor({ home: home, from: dir });
assert.deepStrictEqual(first.updated, SUPERVISOR_FILES, "三份壳都铺过去（含安装根原来没有的那份）");
assert.deepStrictEqual(first.missing, []);
assert.strictEqual(first.failure, "");
for (const name of SUPERVISOR_FILES) {
  assert.strictEqual(read(home, name), NEW_SHELL[name], "安装根的 " + name + " 变成生效那一版的");
}

// 第二遍：内容一样 → 不动（别每次启动都重写一遍）。
const second = syncSupervisor({ home: home, from: dir });
assert.deepStrictEqual(second.updated, [], "一样就不动");
assert.deepStrictEqual(second.same, SUPERVISOR_FILES, "三份都算「本来就一样」");

// 生效那一份里没有壳（很老的版本目录）：跳过，不算失败。
const bare = versionDir(home, "0.1.0", { "server.js": "// 老的版本，没有壳\n" });
const third = syncSupervisor({ home: home, from: bare });
assert.deepStrictEqual(third.updated, []);
assert.deepStrictEqual(third.missing, SUPERVISOR_FILES, "源里没有就跳过");
assert.strictEqual(third.failure, "");
assert.strictEqual(read(home, "launch.js"), NEW_SHELL["launch.js"], "跳过时不动安装根那份");

// 生效那份就是安装根自己（没有指针）：同一个目录，没什么可对齐的。
assert.deepStrictEqual(syncSupervisor({ home: home, from: home }).updated, [], "没有指针时不动");

// 别处的副本（不在这个安装根下）：不碰这台机器的安装根。
const other = fs.mkdtempSync(path.join(os.tmpdir(), "gui-bootstrap-other-"));
write(other, "launch.js", "// 别处的壳\n");
const outside = syncSupervisor({ home: home, from: other });
assert.deepStrictEqual(outside.updated, [], "不在同一个安装根下的副本不铺");
assert.strictEqual(read(home, "launch.js"), NEW_SHELL["launch.js"], "安装根那份没被动过");

// 铺不动（安装根那份是个目录，改名过不去）：报出原因，不往上抛。
const blocked = sandbox();
const blockedDir = versionDir(blocked, "9.9.9", NEW_SHELL);
fs.rmSync(path.join(blocked, "launch.js"), { force: true });
fs.mkdirSync(path.join(blocked, "launch.js"));
const failed = syncSupervisor({ home: blocked, from: blockedDir });
assert.match(failed.failure, /launch\.js/, "铺不动要说清是哪一份");
assert.deepStrictEqual(failed.updated, [], "失败那一份不算铺成");

for (const dir of [home, other, blocked]) fs.rmSync(dir, { recursive: true, force: true });

/*
 * 清单要跟壳的实际依赖一致：把 launch.js / lib/launch.js 里的相对 require 全找出来，
 * 每一份都必须在 SUPERVISOR_FILES 里 —— 将来壳多 require 一份，这里就红。
 */
function relativeRequires(rel) {
  const text = fs.readFileSync(path.join(ROOT, ...rel.split("/")), "utf8");
  const out = [];
  const pattern = new RegExp("require\\(\"(\\./[^\"]+)\"\\)", "g");
  let match = pattern.exec(text);
  while (match) {
    out.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), match[1])));
    match = pattern.exec(text);
  }
  return out;
}

for (const name of SUPERVISOR_FILES) {
  for (const required of relativeRequires(name)) {
    assert.ok(SUPERVISOR_FILES.includes(required), name + " require 的 " + required + " 要在壳的清单里");
  }
}
assert.ok(SUPERVISOR_FILES.includes("launch.js"), "壳从 launch.js 起算");

process.stdout.write("bootstrap ok\n");
