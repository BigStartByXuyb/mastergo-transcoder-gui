#!/usr/bin/env node
"use strict";

// 交给系统打开：目录与网址共用一处「平台 → 命令」；目录只认绝对路径 + 真目录；
// 拒绝与 spawn 失败都回 {ok:false, reason}。
// 跑法：node tests/system-open.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const { openFolder, openUrl, openerCommand } = require("../lib/system-open.js");

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

  // 参数不对的几种：没给、相对路径、不存在（或不是目录）—— 都回 ok:false + 原因，不去开文件管理器。
  // 与「选择目录」同一条路：界面只读 ok 与 reason。
  async function refused(target, pattern, note) {
    const got = await openFolder(target);
    assert.strictEqual(got.ok, false, note);
    assert.match(got.reason, pattern, note);
  }
  await refused("", /没给目录/, "没给路径");
  await refused("plugins", /要一个绝对路径/, "相对路径不行");
  await refused(path.join(home, "没有这个"), /这个目录不在了/, "目录不存在");
  await refused(path.join(real, "..", "上面那个文件"), /这个目录不在了/, "上一层也没有");
  const file = path.join(home, "a.txt");
  fs.writeFileSync(file, "x", "utf8");
  await refused(file, /这个目录不在了/, "文件不算目录");

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

  /*
   * 网址走同一处映射：Windows 上换的是 cmd 的 start（URL 交给默认浏览器，explorer 不干这件事），
   * 另两个平台与打开目录同一条命令 —— 「哪个平台用哪条命令」只写一份，就是这里。
   */
  const page = "http://127.0.0.1:8787/";
  assert.deepStrictEqual(openerCommand("win32", "url", page), { command: "cmd", args: ["/c", "start", "", page] });
  assert.deepStrictEqual(openerCommand("darwin", "url", page), { command: "open", args: [page] });
  assert.deepStrictEqual(openerCommand("linux", "url", page), { command: "xdg-open", args: [page] });
  assert.deepStrictEqual(openerCommand("win32", "dir", real), { command: "explorer.exe", args: [real] });

  const browsed = fakeSpawn();
  assert.deepStrictEqual(await openUrl(page, { platform: "win32", spawnImpl: browsed.spawnImpl }), { ok: true, reason: "" });
  assert.strictEqual(browsed.calls[0].command, "cmd");
  assert.deepStrictEqual(browsed.calls[0].args, ["/c", "start", "", page]);

  // 只认 http(s)：别的协议不当成网址去开。
  const refusedUrl = await openUrl("file:///C:/x.html", { platform: "win32", spawnImpl: fakeSpawn().spawnImpl });
  assert.strictEqual(refusedUrl.ok, false);
  assert.match(refusedUrl.reason, /只打开 http\(s\) 地址/);

  // spawn 起不来：回原因，不抛（界面照实显示）。
  const broken = fakeSpawn("error");
  const brokenResult = await openFolder(real, { platform: "win32", spawnImpl: broken.spawnImpl });
  assert.strictEqual(brokenResult.ok, false);
  assert.ok(brokenResult.reason.includes("找不到命令"), brokenResult.reason);

  fs.rmSync(home, { recursive: true, force: true });
  console.log("system-open ok");
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
