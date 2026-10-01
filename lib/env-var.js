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

const path = require("path");

const { runPwshJson } = require("./pwsh.js");

const SCRIPT = path.join(__dirname, "env-var.ps1");

/*
 * 读写都走一次 pwsh，结果从文件读回来（口径与编码检查都在 lib/pwsh.js）。
 */
function run(args, options) {
  const o = options || {};
  const got = runPwshJson({
    label: "环境变量",
    args: ["-File", SCRIPT].concat(args),
    tmpPrefix: "mtslg-env-",
    maxBuffer: 8 * 1024 * 1024,
    pwsh: o.pwsh,
    timeoutMs: o.timeoutMs,
    spawnImpl: o.spawnImpl
  });
  if (got.reason) return { name: "", process: "", user: "", machine: "", written: false, unsupported: false, failure: got.failure };
  const parsed = got.value;
  return {
    name: String(parsed.name || ""),
    process: String(parsed.process || ""),
    user: String(parsed.user || ""),
    machine: String(parsed.machine || ""),
    written: parsed.written === true,
    unsupported: false,
    failure: ""
  };
}

// 非 Windows 没有「用户级环境变量」这一层：回一句说明，标成 unsupported（不是故障，别当错误抛）。
function notWindows() {
  return {
    name: "",
    process: "",
    user: "",
    machine: "",
    written: false,
    unsupported: true,
    failure: "只有 Windows 有用户级环境变量，这一项在本机不可用。"
  };
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
