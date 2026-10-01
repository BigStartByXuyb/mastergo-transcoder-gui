"use strict";

/*
 * 环境变量（Windows 用户作用域）：读三个作用域，写/清「用户」那一份。
 *
 * 谁在用：设置 → 插件 那一页让用户把 MASTERGO_PLUGIN_ROOT 固定下来 ——
 * 和这一页的「用这份」是两件事：那份是本客户端内部立刻生效，这份是写给系统、
 * 以后新起的进程（含别的工具与命令行）都读得到。
 *
 * 边界：只写用户作用域，Machine 要管理员所以只读不写；值的合法性由调用方校验。
 * 生效时机：写完之后由新起的进程读到，当前进程的 process.env 不会变 ——
 * 所以界面要把「这次运行读到的」和「系统里存的」分开显示，不能混成一个值。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { resolvePwsh } = require("./plugin.js");

const SCRIPT = path.join(__dirname, "env-var.ps1");
const TIMEOUT_MS = 30000;

/*
 * 读写都走一次 pwsh：结果由脚本写进临时文件（-OutFile），
 * 不走 stdout —— 控制台代码页是 GBK，中文路径过一趟就会被替换成 U+FFFD。
 */
function run(args, options) {
  const o = options || {};
  const spawn = o.spawnImpl || spawnSync;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtslg-env-"));
  const outFile = path.join(dir, "result.json");
  try {
    const result = spawn(o.pwsh || resolvePwsh(), ["-NoProfile", "-File", SCRIPT].concat(args, ["-OutFile", outFile]), {
      encoding: "utf8",
      timeout: o.timeoutMs || TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024
    });
    if (result.error) return { failure: "调不起 pwsh：" + result.error.message };
    let raw = "";
    try {
      raw = fs.readFileSync(outFile, "utf8").replace(/^\uFEFF/, "");
    }
    catch {
      const detail = String(result.stderr || result.stdout || "").trim().slice(0, 400);
      return { failure: "环境变量没读出来（pwsh 退出码 " + String(result.status) + "）" + (detail ? "：" + detail : "") };
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    }
    catch (error) {
      return { failure: "环境变量的读取结果不是合法 JSON：" + error.message };
    }
    return {
      name: String(parsed.name || ""),
      process: String(parsed.process || ""),
      user: String(parsed.user || ""),
      machine: String(parsed.machine || ""),
      written: parsed.written === true,
      failure: ""
    };
  }
  finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 非 Windows 没有「用户级环境变量」这一层，直接回空值加一句说明，不当作错误。
function notWindows() {
  return { name: "", process: "", user: "", machine: "", written: false, failure: "只有 Windows 有用户级环境变量，这一项在本机不可用。" };
}

function readEnvVar(name, options) {
  const o = options || {};
  if ((o.platform || process.platform) !== "win32") return notWindows();
  return run(["-Name", name], o);
}

/* value 为空串＝删掉这个变量。 */
function writeEnvVar(name, value, options) {
  const o = options || {};
  if ((o.platform || process.platform) !== "win32") return notWindows();
  const wanted = String(value === undefined || value === null ? "" : value).trim();
  return run(wanted ? ["-Name", name, "-Value", wanted] : ["-Name", name, "-Clear"], o);
}

module.exports = { readEnvVar, writeEnvVar };
