"use strict";

/*
 * 允许不允许用系统上那两份运行时（Node / PowerShell 7）。
 *
 * 默认不允许：客户机上装的是什么版本不该决定我们跑哪一版 —— 关键路径上的东西必须是我们钉死的那一份。
 * 要用系统那份，得在设置里显式打开（设置 → 更新 → 运行环境）。
 *
 * 谁在用：lib/runtime.js 的两个解析函数。取值现读：设置里刚打开不用重启客户端。
 * 装配只在一处：server.js 把「设置里那个开关」接进来；没接之前一律当作不允许。
 */

let source = function () { return false; };

function setSource(read) {
  source = typeof read === "function" ? read : function () { return false; };
}

function allowSystem() {
  try {
    return source() === true;
  }
  catch {
    // 读设置出错时按「不允许」走：宁可用我们自己那份，也不悄悄换成系统那份。
    return false;
  }
}

module.exports = { setSource, allowSystem };
