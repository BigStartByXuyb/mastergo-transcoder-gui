"use strict";

/*
 * 在系统文件管理器里打开一个目录：Windows 用 explorer，macOS 用 open，Linux 用 xdg-open。
 *
 * 谁在用：lib/routes.js 的 POST /api/system/open-folder（插件页某一行里的「打开目录」）。
 * 边界：只认「绝对路径 + 真的存在 + 是目录」；打不开就把原因回给界面，界面照实说，不静默。
 * 文件管理器打开后就立刻返回（explorer 的退出码不可靠），所以这里只等 spawn 成功/失败，不等进程结束。
 */

const fs = require("fs");
const path = require("path");
const { spawn: spawnChild } = require("child_process");

const { UserError } = require("./errors.js");

// 平台 → 用哪个命令打开目录：参数只有目录一个，路径带空格也不用拼引号（数组传参）。
function commandOf(platform, dir) {
  if (platform === "win32") return { command: "explorer.exe", args: [dir] };
  if (platform === "darwin") return { command: "open", args: [dir] };
  return { command: "xdg-open", args: [dir] };
}

function openFolder(target, options) {
  const o = options || {};
  const platform = o.platform || process.platform;
  const spawn = o.spawnImpl || spawnChild;
  const statOf = o.statSync || fs.statSync;
  const dir = String(target || "").trim();
  if (!dir) throw new UserError("NO_PATH", "没给目录", "从某一行的「打开目录」进来时要把路径带上。");
  if (!path.isAbsolute(dir)) throw new UserError("BAD_PATH", "要一个绝对路径", dir);
  let stat = null;
  try {
    stat = statOf(dir);
  }
  catch {
    stat = null;
  }
  if (!stat || !stat.isDirectory()) throw new UserError("NO_DIR", "这个目录不在了", dir);

  const { command, args } = commandOf(platform, dir);
  return new Promise(function (resolve) {
    const child = spawn(command, args, { windowsHide: true, detached: true, stdio: "ignore" });
    let settled = false;
    const done = function (value) {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.on("spawn", function () {
      // 文件管理器自己活；不跟着本进程一起被收走。
      if (typeof child.unref === "function") child.unref();
      done({ ok: true, reason: "" });
    });
    child.on("error", function (error) {
      done({ ok: false, reason: "打不开文件管理器：" + String((error && error.message) || error) });
    });
  });
}

module.exports = { openFolder };
