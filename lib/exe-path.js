"use strict";

/*
 * 在环境里找可执行文件。与领域无关：运行时（Node / PowerShell 7 / Claude Code）与 Codex 引擎都用它。
 *
 * 三条规则各只在这里一份：
 *   - PATH 变量叫什么（Windows 上真名是 Path，只认一种拼法会漏）；
 *   - 同一份工具在各平台叫什么名（Windows 带 .exe / .cmd，其他平台不带）；
 *   - 「环境变量指的根 + 相对片段」怎么拼。
 * 边界：只查文件在不在，不判断它能不能跑（那是各自的 probe 的事）。
 */

const fs = require("fs");
const path = require("path");

/* 环境里那条 PATH 叫什么：Windows 上真名是 Path，只认一种拼法会漏。 */
function pathKeyOf(env) {
  return Object.keys(env || {}).filter(function (name) { return /^path$/i.test(name); })[0] || "PATH";
}

/* 环境里 PATH 那一条的目录列表。 */
function pathDirs(env) {
  return String((env || {})[pathKeyOf(env)] || "").split(path.delimiter).filter(Boolean);
}

/* 同一份工具在不同平台上的可执行名；平台可以显式给（调用方有自己的可注入平台时按它的走）。 */
function platformNames(names, platform) {
  if ((platform || process.platform) === "win32") return names.slice();
  return names.map(function (name) { return name.replace(/\.(exe|cmd|bat)$/i, ""); });
}

/* 在 PATH 上找：逐个目录看有没有这个文件，找到返回绝对路径，否则空串。 */
function onPath(names, env) {
  for (const dir of pathDirs(env)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "";
}

/* 按「环境变量指的根 + 相对片段」拼一个候选：变量没设就返回空串。 */
function underEnv(env, name, parts) {
  const base = (env || {})[name];
  return base ? path.join.apply(path, [base].concat(parts)) : "";
}

module.exports = { pathKeyOf, pathDirs, platformNames, onPath, underEnv };
