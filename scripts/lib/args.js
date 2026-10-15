"use strict";

/*
 * 命令行取值：`--名字 值`，没给或后面跟的是下一个选项就回落默认值。
 * winget、打包、发布这几个脚本共用这一份 —— 同一个 `--base` 不该在不同脚本里被解释成两种意思。
 * （`scripts/pack-plugin.js` 那套是拒绝未知参数的严格解析，取向不同，各留各的。）
 */

function argValue(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

module.exports = { argValue: argValue };
