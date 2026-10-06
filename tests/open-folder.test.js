#!/usr/bin/env node
"use strict";

// 打开目录：只认绝对路径 + 真目录；命令与参数按平台给；spawn 失败把原因回给界面。
// 跑法：node tests/open-folder.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const { openFolder } = require("../lib/open-folder.js");

// 假子进程：只用到 on/unref，spawn 之后自己发一次 spawn（或 error）。
function fakeSpawn(behaviour) {
  const calls = [];
  const spawnImpl = function (command, args, options) {
    calls.push({ command: command, args: args, options: options });
    const child = new EventEmitter();
    child.unref = function () { child.unrefed = true; };
    process.nextTick(function () {
      if (behaviour === "error") child.emit("error", new Error("找不到命令"));
      else child.emit("spawn");
    });
    return child;
  };
  return { calls: calls, spawnImpl: spawnImpl };
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gui-open-folder-"));
  const real = path.join(home, "plugins");
  fs.mkdirSync(real, { recursive: true });

  // 参数不对的三种：没给、相对路径、不存在（或不是目录）—— 都直接拒，不去开文件管理器。
  assert.throws(function () { openFolder(""); }, /没给目录/);
  assert.throws(function () { openFolder("plugins"); }, /要一个绝对路径/);
  assert.throws(function () { openFolder(path.join(home, "没有这个")); }, /这个目录不在了/);
  assert.throws(function () { openFolder(path.join(real, "..", "上面那个文件")); }, /这个目录不在了/);
  const file = path.join(home, "a.txt");
  fs.writeFileSync(file, "x", "utf8");
  assert.throws(function () { openFolder(file); }, /这个目录不在了/, "文件不算目录");

  // Windows：explorer + 目录；路径原样当一个参数（带空格也不拼引号）。
  const spaced = path.join(home, "有 空格 的目录");
  fs.mkdirSync(spaced, { recursive: true });
  const win = fakeSpawn();
  const winResult = await openFolder(spaced, { platform: "win32", spawnImpl: win.spawnImpl });
  assert.deepStrictEqual(winResult, { ok: true, reason: "" });
  assert.strictEqual(win.calls.length, 1);
  assert.strictEqual(win.calls[0].command, "explorer.exe");
  assert.deepStrictEqual(win.calls[0].args, [spaced], "目录原样传参，不自己加引号");
  assert.strictEqual(win.calls[0].options.windowsHide, true);
  assert.strictEqual(win.calls[0].options.detached, true);

  // 另两个平台各用各的命令（这一档只在别的机器上跑，口径在这里钉住）。
  const mac = fakeSpawn();
  await openFolder(real, { platform: "darwin", spawnImpl: mac.spawnImpl });
  assert.strictEqual(mac.calls[0].command, "open");
  const linux = fakeSpawn();
  await openFolder(real, { platform: "linux", spawnImpl: linux.spawnImpl });
  assert.strictEqual(linux.calls[0].command, "xdg-open");

  // spawn 起不来：回原因，不抛（界面照实显示）。
  const broken = fakeSpawn("error");
  const brokenResult = await openFolder(real, { platform: "win32", spawnImpl: broken.spawnImpl });
  assert.strictEqual(brokenResult.ok, false);
  assert.ok(brokenResult.reason.includes("找不到命令"), brokenResult.reason);

  fs.rmSync(home, { recursive: true, force: true });
  console.log("open-folder ok");
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
