"use strict";

/*
 * 选文件夹：Windows 上弹一个系统文件夹选择框，把用户选中的路径回给界面。
 *
 * 谁在用：lib/routes.js 的 POST /api/system/pick-folder（「代码库」那页的「浏览…」）。
 * 边界：只在 Windows 上可用；取消 / 超时 / 没有桌面会话都回空路径，界面退回落手填。
 * 用异步 spawn：对话框开着的时候服务还得能响应别的请求，不能被卡住。
 */

const { spawn: spawnChild } = require("child_process");

const { resolvePwsh } = require("./plugin.js");

const TIMEOUT_MS = 180000;

// -STA 是 FolderBrowserDialog 的要求；选择结果走 stdout，别的都丢。
const SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
  "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$d.Description = '选择代码库目录'",
  "$d.ShowNewFolderButton = $false",
  "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }"
].join("; ");

function pickFolder(options) {
  const o = options || {};
  const platform = o.platform || process.platform;
  if (platform !== "win32") {
    return Promise.resolve({ ok: false, path: "", reason: "只有 Windows 会弹选择框，路径手填就行。" });
  }
  const spawn = o.spawnImpl || spawnChild;
  return new Promise(function (resolve) {
    const child = spawn(resolvePwsh(), ["-NoProfile", "-STA", "-Command", SCRIPT], { windowsHide: true });
    let out = "";
    let settled = false;
    const done = function (value) {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(function () {
      try { child.kill(); } catch { /* 已经退出了 */ }
      done({ ok: false, path: "", reason: "选择框开太久，已取消；路径手填就行。" });
    }, o.timeoutMs || TIMEOUT_MS);
    child.stdout.on("data", function (chunk) { out += String(chunk); });
    child.on("error", function (error) {
      clearTimeout(timer);
      done({ ok: false, path: "", reason: "打不开选择框：" + (error && error.message ? error.message : String(error)) });
    });
    child.on("exit", function (code) {
      clearTimeout(timer);
      if (code !== 0) {
        done({ ok: false, path: "", reason: "选择框没能打开（退出码 " + code + "），路径手填就行。" });
        return;
      }
      done({ ok: true, path: out.trim() });
    });
  });
}

module.exports = { pickFolder };
