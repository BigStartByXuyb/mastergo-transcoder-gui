"use strict";

/*
 * 允许不允许用系统上那份运行时（Node / PowerShell 7），逐份问。
 *
 * 默认都不允许：客户机上装的是什么版本不该决定我们跑哪一版 —— 关键路径上的东西必须是我们钉死的那一份。
 * 要用系统那份，得在「运行环境」页按那一行显式选（设置里的 runtime.system）。
 *
 * 谁在用：lib/runtime.js 的解析与状态。取值现读：设置里刚改完不用重启客户端。
 * 装配只在一处：server.js 把设置里那张表接进来；没接之前一律当作不允许。
 */

let source = function () { return {}; };

function setSource(read) {
  source = typeof read === "function" ? read : function () { return {}; };
}

/* tool：node / pwsh。读不到、读坏了都按「不允许」走 —— 宁可用我们自己那份，也不悄悄换成系统那份。 */
function allowSystem(tool) {
  try {
    const table = source();
    return Boolean(table && table[tool] === true);
  }
  catch {
    return false;
  }
}

module.exports = { setSource, allowSystem };
