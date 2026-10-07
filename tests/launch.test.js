#!/usr/bin/env node
"use strict";

// 启动选版：指针指到完整的那一份就用它，指空/指坏/指向残缺目录都退回安装根自己这一份。
// 跑法：node tests/launch.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { resolveLaunch, supervisorAlive, RESTART_CODE } = require("../lib/launch.js");

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

// 子进程的退出码就是监督进程的协议：换一份重跑用 75，其余码一律当作结束（两端同读这一份）。
assert.strictEqual(RESTART_CODE, 75, "重启码是 75，改动它要两端一起改");

/*
 * 监督进程探活：子进程按 75 退出去等它拉起自己，所以得先知道它还在不在 ——
 * 它没了（启动窗口被关掉）还照退，就会变成「切完版本服务没人拉起来、页面打不开」。
 */
assert.strictEqual(supervisorAlive({ ppid: 1234, kill: function () {} }), true, "探得到就是在");
assert.strictEqual(
  supervisorAlive({ ppid: 1234, kill: function () { throw new Error("ESRCH"); } }),
  false,
  "探不到（进程没了）＝不在"
);
assert.strictEqual(supervisorAlive({ ppid: 0, kill: function () {} }), false, "读不到 ppid 就当不在");

process.stdout.write("launch ok\n");
