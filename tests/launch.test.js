#!/usr/bin/env node
"use strict";

// 启动选版：指针指到完整的那一份就用它，指空/指坏/指向残缺目录都退回安装根自己这一份。
// 跑法：node tests/launch.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { resolveLaunch } = require("../lib/launch.js");

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-launch-"));
  fs.writeFileSync(path.join(home, "server.js"), "// root copy\n", "utf8");
  return home;
}

function stageVersion(home, version) {
  const dir = path.join(home, "versions", version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "server.js"), "// " + version + "\n", "utf8");
  return dir;
}

function point(home, pointer) {
  fs.writeFileSync(path.join(home, "current.json"), JSON.stringify(pointer, null, 2) + "\n", "utf8");
}

const home = makeHome();
const empty = resolveLaunch(home);
assert.strictEqual(empty.dir, home, "没有指针就用安装根自己这一份");
assert.strictEqual(empty.fromPointer, false);

const dir = stageVersion(home, "0.4.0");
point(home, { version: "0.4.0", previous: "0.3.0" });
const staged = resolveLaunch(home);
assert.strictEqual(staged.dir, dir, "指针指到哪一份就用哪一份");
assert.strictEqual(staged.version, "0.4.0");
assert.strictEqual(staged.fromPointer, true);

point(home, { version: "9.9.9" });
assert.strictEqual(resolveLaunch(home).dir, home, "指针指向不存在的版本就退回安装根");

fs.rmSync(path.join(dir, "server.js"));
point(home, { version: "0.4.0" });
assert.strictEqual(resolveLaunch(home).dir, home, "版本目录残了就退回安装根");

fs.writeFileSync(path.join(home, "current.json"), "{ 坏掉的 json", "utf8");
assert.strictEqual(resolveLaunch(home).dir, home, "指针读不出来就退回安装根");

fs.rmSync(home, { recursive: true, force: true });
process.stdout.write("launch ok\n");
