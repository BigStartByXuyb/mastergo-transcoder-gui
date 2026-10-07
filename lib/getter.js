"use strict";

/*
 * 「给值」或「给取值函数」两种写法都接受，统一成取值函数。
 * 装配处传死值（启动时定下的）、设置页传闭包（改完不重启也按新的走），调用方不必分这两种。
 * 谁在用：token、发布源、运行时安装包来源这些「现取」的入口。
 * 边界：只做归一化；空值给什么由调用方说（默认空串）。
 */

function getterOf(value, fallback) {
  if (typeof value === "function") return value;
  const empty = fallback === undefined ? "" : fallback;
  return function () {
    return value === undefined || value === null ? empty : value;
  };
}

module.exports = { getterOf };
