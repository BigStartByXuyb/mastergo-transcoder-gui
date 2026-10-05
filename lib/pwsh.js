"use strict";

/*
 * 起 pwsh 跑一段脚本，结果从文件读回来。
 *
 * 为什么不读 stdout：控制台代码页是本机 ANSI（中文机器上是 GBK），中文过一趟 stdout
 * 就会变成 U+FFFD。文件是确定编码，所以脚本一律用 -OutFile 写结果，这里只读那个文件。
 * 读出替换字符一律当作编码损坏，不把坏内容往下传 —— 宁可报错，也不给一条被改过的路径。
 *
 * 谁在用：lib/plugin.js（读流水线步骤契约）、lib/env-var.js（读写环境变量）。
 * 返回用 reason 分档（spawn / missing / encoding / json），由调用方翻成自己的错误码。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { requirePwshExe } = require("./runtime.js");

const TIMEOUT_MS = 60000;
const MAX_BUFFER = 32 * 1024 * 1024;

/*
 * options:
 *   args      传给脚本的参数（-OutFile 由这里补）
 *   label     出错时用来自报家门的名字（如「流水线」）
 *   env       子进程环境（插件脚本要自带 node/pwsh 那份 PATH）
 *   timeoutMs / maxBuffer / pwsh / spawnImpl / tmpPrefix   覆盖项，默认够用
 */
function runPwshJson(options) {
  const o = options || {};
  const label = o.label || "pwsh";
  const spawn = o.spawnImpl || spawnSync;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), o.tmpPrefix || "mtslg-pwsh-"));
  const outFile = path.join(dir, "out.json");
  try {
  const result = spawn(o.pwsh || requirePwshExe(), ["-NoProfile"].concat(o.args || [], ["-OutFile", outFile]), {
      encoding: "utf8",
      timeout: o.timeoutMs || TIMEOUT_MS,
      maxBuffer: o.maxBuffer || MAX_BUFFER,
      env: o.env
    });
    if (result.error) {
      return { reason: "spawn", failure: label + " 起不来：" + result.error.message };
    }
    let raw = "";
    try {
      raw = fs.readFileSync(outFile, "utf8").replace(/^\uFEFF/, "");
    }
    catch {
      const detail = String(result.stderr || result.stdout || "").trim().slice(0, 800);
      return {
        reason: "missing",
        failure: label + " 没有写出结果文件（pwsh 退出码 " + String(result.status) + "）" + (detail ? "：" + detail : "")
      };
    }
    if (raw.includes("\uFFFD")) {
      return { reason: "encoding", failure: label + " 的结果出现替换字符（编码损坏）" };
    }
    try {
      return { value: JSON.parse(raw) };
    }
    catch (error) {
      return { reason: "json", failure: label + " 的结果不是合法 JSON：" + error.message };
    }
  }
  finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { runPwshJson };
