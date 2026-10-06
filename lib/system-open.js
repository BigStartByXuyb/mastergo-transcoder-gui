"use strict";

/*
 * 交给系统打开东西：一个目录（在文件管理器里打开）或一个网址（用默认浏览器打开）。
 *
 * 谁在用：lib/routes.js 的 POST /api/system/open-folder（插件页某一行里的「打开目录」）、
 * server.js 起完服务顺手打开界面。两件事是同一类动作，所以「哪个平台用哪条命令」只有这一处：
 *
 *   win32   目录 explorer.exe <目录>（就是「在文件管理器里打开」）
 *           网址 cmd /c start "" <网址>（URL 要交给默认浏览器，explorer 不干这件事）
 *   darwin  两者都用 open
 *   其它    两者都用 xdg-open
 *
 * 边界（目录那一侧）：只认「绝对路径 + 真的存在 + 是目录」；打不开就把原因回给界面，界面照实说，不静默。
 * 目录打开后立刻返回（explorer 的退出码不可靠），所以这里只等 spawn 成功/失败，不等进程结束。
 * 失败一律回 {ok:false, reason}（与「选择目录」lib/pick-folder.js 同一形状）：这两种都是「跟系统打交道
 * 要个结果」，界面按同一条路读 ok 与 reason，不用一处判返回值、另一处接错误码。
 */

const fs = require("fs");
const path = require("path");
const { spawn: spawnChild } = require("child_process");

const KIND_DIR = "dir";
const KIND_URL = "url";

// 平台 + 要打开什么 → 命令与参数。参数只放目标一个（数组传参，路径带空格也不用拼引号）。
function openerCommand(platform, kind, target) {
  if (platform === "win32") {
    if (kind === KIND_URL) return { command: "cmd", args: ["/c", "start", "", target] };
    return { command: "explorer.exe", args: [target] };
  }
  if (platform === "darwin") return { command: "open", args: [target] };
  return { command: "xdg-open", args: [target] };
}

function refuse(reason) {
  return Promise.resolve({ ok: false, reason: reason });
}

/*
 * 起一个「打开器」：起来了就算成（文件管理器与浏览器自己活，不跟着本进程一起被收走）。
 * spawn 同步抛（参数不对那类）也当成「打不开」，这一处保证返回的 Promise 不会 reject ——
 * 调用方（server.js 起完服务顺手开浏览器）只关心有没有起来，不必再包一层近乎恒真的 catch。
 */
function launch(platform, kind, target, spawn) {
  const { command, args } = openerCommand(platform, kind, target);
  return new Promise(function (resolve) {
    let child = null;
    try {
      child = spawn(command, args, { windowsHide: true, detached: true, stdio: "ignore" });
    }
    catch (error) {
      resolve({ ok: false, reason: "打不开文件管理器：" + String((error && error.message) || error) });
      return;
    }
    let settled = false;
    const done = function (value) {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.on("spawn", function () {
      if (typeof child.unref === "function") child.unref();
      done({ ok: true, reason: "" });
    });
    child.on("error", function (error) {
      done({ ok: false, reason: "打不开文件管理器：" + String((error && error.message) || error) });
    });
  });
}

function openFolder(target, options) {
  const o = options || {};
  const platform = o.platform || process.platform;
  const spawn = o.spawnImpl || spawnChild;
  const statOf = o.statSync || fs.statSync;
  const dir = String(target || "").trim();
  if (!dir) return refuse("没给目录");
  if (!path.isAbsolute(dir)) return refuse("要一个绝对路径：" + dir);
  let stat = null;
  try {
    stat = statOf(dir);
  }
  catch {
    stat = null;
  }
  if (!stat || !stat.isDirectory()) return refuse("这个目录不在了：" + dir);
  return launch(platform, KIND_DIR, dir, spawn);
}

/* 打开网址：只认 http(s)，别的（file:、javascript: 之类）一律不做。 */
function openUrl(url, options) {
  const o = options || {};
  const platform = o.platform || process.platform;
  const spawn = o.spawnImpl || spawnChild;
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) return refuse("只打开 http(s) 地址：" + target);
  return launch(platform, KIND_URL, target, spawn);
}

module.exports = { openFolder, openUrl, openerCommand };
