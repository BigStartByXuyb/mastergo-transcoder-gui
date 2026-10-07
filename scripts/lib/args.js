"use strict";

/*
 * 命令行取值：`--名字 值`，没给或后面跟的是下一个选项就回落默认值。
 * 仓库里的脚本共用这一份 —— 同一个 `--base` 不该在不同脚本里被解释成两种意思。
 */

function argValue(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

module.exports = { argValue: argValue };
